use crate::{compute_sha256, is_under_dir, normalize_ext, ScanFilesArgs};
use crate::qdrant;
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};
use tokio::sync::{watch, Mutex};
use walkdir::WalkDir;

const OUTPUT_DIM: usize = 768;
const MAX_FILE_BYTES: u64 = 25 * 1024 * 1024; // 25MB
const GEMINI_MODEL: &str = "models/gemini-embedding-2-preview";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EmbeddingJobPhase {
    Idle,
    Scanning,
    Embedding,
    Paused,
    Cancelling,
    Done,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddingJobStatus {
    pub phase: EmbeddingJobPhase,
    pub processed: u64,
    pub total: u64,
    pub message: String,
}

#[derive(Debug)]
pub struct EmbeddingManager {
    state: Mutex<EmbeddingManagerState>,
}

#[derive(Debug)]
struct EmbeddingManagerState {
    running: bool,
    phase: EmbeddingJobPhase,
    processed: u64,
    total: u64,
    message: String,
    pause_tx: watch::Sender<bool>,
    cancel_flag: Arc<AtomicBool>,
}

impl Default for EmbeddingManager {
    fn default() -> Self {
        let (pause_tx, _pause_rx) = watch::channel(false);
        Self {
            state: Mutex::new(EmbeddingManagerState {
                running: false,
                phase: EmbeddingJobPhase::Idle,
                processed: 0,
                total: 0,
                message: "Idle".to_string(),
                pause_tx,
                cancel_flag: Arc::new(AtomicBool::new(false)),
            }),
        }
    }
}

impl EmbeddingManager {
    pub async fn status(&self) -> EmbeddingJobStatus {
        let s = self.state.lock().await;
        EmbeddingJobStatus {
            phase: s.phase.clone(),
            processed: s.processed,
            total: s.total,
            message: s.message.clone(),
        }
    }
}

fn mime_type_for_ext(ext: &str) -> Option<&'static str> {
    match ext {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "pdf" => Some("application/pdf"),
        "mp3" => Some("audio/mpeg"),
        "wav" => Some("audio/wav"),
        "mp4" => Some("video/mp4"),
        "mov" => Some("video/quicktime"),
        _ => None,
    }
}

fn read_gemini_api_key() -> Result<String, String> {
    let key = std::env::var("MANIFOLD_GEMINI_API_KEY")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .or_else(|| {
            std::env::var("GOOGLE_GENERATIVE_AI_API_KEY")
                .ok()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
        })
        .ok_or_else(|| {
            "Missing MANIFOLD_GEMINI_API_KEY (or GOOGLE_GENERATIVE_AI_API_KEY) in .env.local"
                .to_string()
        })?;
    Ok(key)
}

fn should_emit(last_emit: &mut Instant, processed: u64, total: u64) -> bool {
    if processed == 0 {
        return true;
    }
    if processed >= total {
        return true;
    }
    if processed % 25 == 0 {
        return true;
    }
    if last_emit.elapsed() >= Duration::from_millis(250) {
        return true;
    }
    false
}

fn emit_status(app: &tauri::AppHandle, status: &EmbeddingJobStatus) {
    let _ = app.emit("embedding://status", status);
}

fn emit_error(app: &tauri::AppHandle, message: &str) {
    let _ = app.emit(
        "embedding://error",
        serde_json::json!({ "message": message }),
    );
}

fn emit_file_failed(app: &tauri::AppHandle, path: &std::path::Path, reason: &str) {
    let _ = app.emit(
        "embedding://file-failed",
        serde_json::json!({
            "path": path.to_string_lossy().to_string(),
            "reason": reason
        }),
    );
}

fn emit_done(app: &tauri::AppHandle) {
    let _ = app.emit("embedding://done", serde_json::json!({ "ok": true }));
}

async fn wait_if_paused(
    pause_rx: &mut watch::Receiver<bool>,
    cancel_flag: &Arc<AtomicBool>,
) -> Result<(), String> {
    loop {
        if cancel_flag.load(Ordering::Relaxed) {
            return Err("Cancelled".to_string());
        }
        if !*pause_rx.borrow() {
            return Ok(());
        }
        pause_rx
            .changed()
            .await
            .map_err(|_| "Pause channel closed".to_string())?;
    }
}

async fn scan_total(args: &ScanFilesArgs) -> u64 {
    let include_dirs: Vec<PathBuf> = args.include.iter().map(PathBuf::from).collect();
    let exclude_dirs: Vec<PathBuf> = args.exclude.iter().map(PathBuf::from).collect();
    let allowed_exts: std::collections::HashSet<String> =
        args.extensions.iter().map(|e| normalize_ext(e)).collect();

    let mut total: u64 = 0;
    for root in include_dirs {
        if !root.exists() {
            continue;
        }
        for entry in WalkDir::new(root).follow_links(false).into_iter() {
            let entry = match entry {
                Ok(e) => e,
                Err(_) => continue,
            };
            if !entry.file_type().is_file() {
                continue;
            }
            let path = entry.path();
            if exclude_dirs.iter().any(|ex| is_under_dir(path, ex)) {
                continue;
            }
            let ext = path
                .extension()
                .and_then(|s| s.to_str())
                .map(normalize_ext);
            let Some(ext) = ext else { continue };
            if !allowed_exts.contains(&ext) {
                continue;
            }
            if mime_type_for_ext(&ext).is_none() {
                continue;
            }
            total = total.saturating_add(1);
        }
    }
    total
}

#[derive(Debug, Deserialize)]
struct GeminiEmbedResponse {
    #[serde(default)]
    embedding: Option<GeminiEmbeddingValues>,
    #[serde(default)]
    embeddings: Option<Vec<GeminiEmbeddingValues>>,
}

#[derive(Debug, Deserialize)]
struct GeminiEmbeddingValues {
    values: Vec<f32>,
}

fn l2_normalize_vec(mut v: Vec<f32>) -> Vec<f32> {
    let mut sum_sq: f64 = 0.0;
    for &x in &v {
        sum_sq += (x as f64) * (x as f64);
    }
    let norm = sum_sq.sqrt() as f32;
    if norm == 0.0 {
        return v;
    }
    for x in &mut v {
        *x /= norm;
    }
    v
}

async fn gemini_embed_post(api_key: &str, body: serde_json::Value) -> Result<Vec<f32>, String> {
    async fn sleep_ms(ms: u64) {
        tokio::time::sleep(Duration::from_millis(ms)).await;
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;

    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/{}:embedContent",
        GEMINI_MODEL
    );

    let mut attempt = 0u32;
    let mut backoff_ms: u64 = 400;
    loop {
        attempt += 1;
        let res = client
            .post(&url)
            .header("Content-Type", "application/json")
            .header("x-goog-api-key", api_key)
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Gemini embedContent request failed: {e}"))?;

        let status = res.status();
        if status.is_success() {
            let json: GeminiEmbedResponse = res
                .json()
                .await
                .map_err(|e| format!("Gemini embedContent invalid JSON: {e}"))?;

            let mut values = json
                .embedding
                .map(|e| e.values)
                .or_else(|| json.embeddings.and_then(|mut es| es.pop().map(|e| e.values)))
                .ok_or_else(|| "Gemini embedContent response missing embedding values".to_string())?;

            if values.len() != OUTPUT_DIM {
                return Err(format!(
                    "Gemini embedContent returned {} floats; expected {}",
                    values.len(),
                    OUTPUT_DIM
                ));
            }

            values = l2_normalize_vec(values);
            return Ok(values);
        }

        let text = res.text().await.unwrap_or_default();
        let retryable = matches!(status.as_u16(), 429 | 500 | 503);
        if retryable && attempt < 5 {
            sleep_ms(backoff_ms).await;
            backoff_ms = std::cmp::min(5000, ((backoff_ms as f64) * 1.8).round() as u64);
            continue;
        }
        return Err(format!(
            "Gemini embedContent failed (HTTP {}): {}",
            status.as_u16(),
            text
        ));
    }
}

async fn embed_with_gemini(
    api_key: &str,
    mime_type: &str,
    bytes: Vec<u8>,
) -> Result<Vec<f32>, String> {
    let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
    let body = serde_json::json!({
        "content": {
            "parts": [{
                "inline_data": {
                    "mime_type": mime_type,
                    "data": b64
                }
            }]
        },
        "output_dimensionality": OUTPUT_DIM
    });
    gemini_embed_post(api_key, body).await
}

/// Embed a search query using the same API key env as file embedding (Rust-side).
pub async fn embed_query_text(text: &str) -> Result<Vec<f32>, String> {
    let api_key = read_gemini_api_key()?;
    let body = serde_json::json!({
        "content": {
            "parts": [{ "text": text }]
        },
        "output_dimensionality": OUTPUT_DIM
    });
    gemini_embed_post(&api_key, body).await
}

pub async fn start(
    app: tauri::AppHandle,
    mgr: tauri::State<'_, EmbeddingManager>,
    _qdrant_state: tauri::State<'_, qdrant::QdrantState>,
    args: ScanFilesArgs,
    source_id: String,
) -> Result<(), String> {
    let mut s = mgr.state.lock().await;
    if s.running {
        return Err("Embedding job already running".to_string());
    }

    let api_key = read_gemini_api_key()?;
    s.running = true;
    s.phase = EmbeddingJobPhase::Scanning;
    s.processed = 0;
    s.total = 0;
    s.message = "Scanning files…".to_string();
    s.cancel_flag.store(false, Ordering::Relaxed);
    let _ = s.pause_tx.send(false);

    emit_status(
        &app,
        &EmbeddingJobStatus {
            phase: s.phase.clone(),
            processed: s.processed,
            total: s.total,
            message: s.message.clone(),
        },
    );

    let mut pause_rx = s.pause_tx.subscribe();
    let cancel_flag = s.cancel_flag.clone();
    drop(s);

    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut last_emit = Instant::now();

        let total = scan_total(&args).await;
        {
            let mgr = app2.state::<EmbeddingManager>();
            let mut s = mgr.state.lock().await;
            s.total = total;
            s.phase = EmbeddingJobPhase::Embedding;
            s.message = if total == 0 {
                "No supported files found to embed.".to_string()
            } else {
                format!("Embedding {total} file(s)…")
            };
            emit_status(
                &app2,
                &EmbeddingJobStatus {
                    phase: s.phase.clone(),
                    processed: s.processed,
                    total: s.total,
                    message: s.message.clone(),
                },
            );
        }

        if total == 0 {
            let mgr = app2.state::<EmbeddingManager>();
            let mut s = mgr.state.lock().await;
            s.phase = EmbeddingJobPhase::Done;
            s.message = "Done".to_string();
            s.running = false;
            emit_done(&app2);
            emit_status(
                &app2,
                &EmbeddingJobStatus {
                    phase: s.phase.clone(),
                    processed: s.processed,
                    total: s.total,
                    message: s.message.clone(),
                },
            );
            return;
        }

        let include_dirs: Vec<PathBuf> = args.include.iter().map(PathBuf::from).collect();
        let exclude_dirs: Vec<PathBuf> = args.exclude.iter().map(PathBuf::from).collect();
        let allowed_exts: std::collections::HashSet<String> =
            args.extensions.iter().map(|e| normalize_ext(e)).collect();

        let mut processed: u64 = 0;

        'outer: for root in include_dirs {
            if !root.exists() {
                continue;
            }
            for entry in WalkDir::new(root).follow_links(false).into_iter() {
                if cancel_flag.load(Ordering::Relaxed) {
                    break 'outer;
                }
                if let Err(e) = wait_if_paused(&mut pause_rx, &cancel_flag).await {
                    emit_error(&app2, &e);
                    break 'outer;
                }

                let entry = match entry {
                    Ok(e) => e,
                    Err(_) => continue,
                };
                if !entry.file_type().is_file() {
                    continue;
                }
                let path = entry.path();
                if exclude_dirs.iter().any(|ex| is_under_dir(path, ex)) {
                    continue;
                }

                let ext = path
                    .extension()
                    .and_then(|s| s.to_str())
                    .map(normalize_ext);
                let Some(ext) = ext else { continue };
                if !allowed_exts.contains(&ext) {
                    continue;
                }
                let Some(mime) = mime_type_for_ext(&ext) else {
                    continue;
                };

                // Size cap early, before hashing/embedding.
                let meta = match std::fs::metadata(path) {
                    Ok(m) => m,
                    Err(_) => continue,
                };
                if meta.len() > MAX_FILE_BYTES {
                    continue;
                }

                // Hash (used for dedupe + Qdrant should_embed check).
                let sha256 = match compute_sha256(path, 1024 * 1024 * 128) {
                    Ok(h) => h,
                    Err(e) => {
                        emit_error(&app2, &e);
                        emit_file_failed(&app2, path, &format!("hash failed: {e}"));
                        continue;
                    }
                };

                // Check if embedding is needed.
                let qdrant_state = app2.state::<qdrant::QdrantState>();
                let should_embed = match qdrant::upsert_metadata(
                    &app2,
                    &qdrant_state,
                    qdrant::UpsertMetadataArgs {
                        source_id: source_id.clone(),
                        path: path.to_string_lossy().to_string(),
                        content_hash: sha256.clone(),
                    },
                )
                .await
                {
                    Ok(r) => r.should_embed,
                    Err(e) => {
                        emit_error(&app2, &e);
                        emit_file_failed(&app2, path, &format!("metadata upsert failed: {e}"));
                        continue;
                    }
                };

                if should_embed {
                    let bytes = match std::fs::read(path) {
                        Ok(b) => b,
                        Err(e) => {
                            emit_error(&app2, &e.to_string());
                            emit_file_failed(&app2, path, &format!("file read failed: {e}"));
                            continue;
                        }
                    };
                    let embedding = match embed_with_gemini(&api_key, mime, bytes).await {
                        Ok(v) => v,
                        Err(e) => {
                            emit_error(&app2, &e);
                            emit_file_failed(&app2, path, &format!("embedding request failed: {e}"));
                            continue;
                        }
                    };
                    if embedding.len() != OUTPUT_DIM {
                        let msg = format!(
                            "Unexpected embedding length {}; expected {}",
                            embedding.len(),
                            OUTPUT_DIM
                        );
                        emit_error(&app2, &msg);
                        emit_file_failed(&app2, path, &msg);
                        continue;
                    }

                    let upsert_res = qdrant::upsert_embedding(
                        &app2,
                        &qdrant_state,
                        qdrant::UpsertEmbeddingArgs {
                            source_id: source_id.clone(),
                            path: path.to_string_lossy().to_string(),
                            content_hash: sha256,
                            embedding,
                        },
                    )
                    .await;
                    if let Err(e) = upsert_res {
                        emit_error(&app2, &e);
                        emit_file_failed(&app2, path, &format!("vector upsert failed: {e}"));
                        continue;
                    }
                }

                processed = processed.saturating_add(1);
                if should_emit(&mut last_emit, processed, total) {
                    let mgr = app2.state::<EmbeddingManager>();
                    let mut s = mgr.state.lock().await;
                    s.processed = processed;
                    s.phase = if *pause_rx.borrow() {
                        EmbeddingJobPhase::Paused
                    } else {
                        EmbeddingJobPhase::Embedding
                    };
                    s.message = "Embedding in progress…".to_string();
                    emit_status(
                        &app2,
                        &EmbeddingJobStatus {
                            phase: s.phase.clone(),
                            processed: s.processed,
                            total: s.total,
                            message: s.message.clone(),
                        },
                    );
                    last_emit = Instant::now();
                }
            }
        }

        let cancelled = cancel_flag.load(Ordering::Relaxed);
        let mgr = app2.state::<EmbeddingManager>();
        let mut s = mgr.state.lock().await;
        s.running = false;
        if cancelled {
            s.phase = EmbeddingJobPhase::Idle;
            s.message = "Cancelled".to_string();
            emit_error(&app2, "Cancelled");
        } else {
            s.phase = EmbeddingJobPhase::Done;
            s.message = "All files embedded.".to_string();
            emit_done(&app2);
        }
        emit_status(
            &app2,
            &EmbeddingJobStatus {
                phase: s.phase.clone(),
                processed: s.processed,
                total: s.total,
                message: s.message.clone(),
            },
        );
    });

    Ok(())
}

pub async fn pause(mgr: tauri::State<'_, EmbeddingManager>) -> Result<(), String> {
    let s = mgr.state.lock().await;
    if !s.running {
        return Err("No embedding job is running".to_string());
    }
    let _ = s.pause_tx.send(true);
    Ok(())
}

pub async fn resume(mgr: tauri::State<'_, EmbeddingManager>) -> Result<(), String> {
    let s = mgr.state.lock().await;
    if !s.running {
        return Err("No embedding job is running".to_string());
    }
    let _ = s.pause_tx.send(false);
    Ok(())
}

pub async fn cancel(mgr: tauri::State<'_, EmbeddingManager>) -> Result<(), String> {
    let s = mgr.state.lock().await;
    if !s.running {
        return Err("No embedding job is running".to_string());
    }
    s.cancel_flag.store(true, Ordering::Relaxed);
    let _ = s.pause_tx.send(false);
    Ok(())
}

