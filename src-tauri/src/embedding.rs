use crate::{compute_sha256, is_under_dir, normalize_ext, normalize_path_key, ScanFilesArgs};
use crate::qdrant;
use crate::text_index;
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

fn supports_text_extraction(ext: &str) -> bool {
    matches!(ext, "png" | "jpg" | "jpeg" | "pdf")
}

fn metadata_text_for_path(path: &std::path::Path) -> String {
    let file_name = path.file_name().and_then(|s| s.to_str()).unwrap_or_default();
    let ext = path.extension().and_then(|s| s.to_str()).unwrap_or_default().to_ascii_lowercase();
    // Intentionally exclude full path so metadata semantic matching is driven by file name.
    format!("filename: {file_name}\nextension: {ext}")
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

#[derive(Debug)]
struct PendingEmbeddingFile {
    path: PathBuf,
    ext: String,
    mime: Option<&'static str>,
    content_hash: String,
    should_embed_content: bool,
    should_embed_metadata: bool,
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

async fn collect_pending_files(
    app: &tauri::AppHandle,
    qdrant_state: &qdrant::QdrantState,
    args: &ScanFilesArgs,
    source_id: &str,
) -> Result<Vec<PendingEmbeddingFile>, String> {
    let include_dirs: Vec<PathBuf> = args.include.iter().map(PathBuf::from).collect();
    let exclude_dirs: Vec<PathBuf> = args.exclude.iter().map(PathBuf::from).collect();
    let allowed_exts: std::collections::HashSet<String> =
        args.extensions.iter().map(|e| normalize_ext(e)).collect();

    let mut out: Vec<PendingEmbeddingFile> = Vec::new();
    let mut seen_paths: std::collections::HashSet<String> = std::collections::HashSet::new();
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
            let path_key = normalize_path_key(path);
            if !seen_paths.insert(path_key) {
                continue;
            }
            let ext = path
                .extension()
                .and_then(|s| s.to_str())
                .map(normalize_ext);
            let Some(ext) = ext else { continue };
            if !allowed_exts.is_empty() && !allowed_exts.contains(&ext) {
                continue;
            }
            let mime = mime_type_for_ext(&ext);
            let meta = match std::fs::metadata(path) {
                Ok(m) => m,
                Err(_) => continue,
            };
            if meta.len() > MAX_FILE_BYTES {
                continue;
            }
            let content_hash = match compute_sha256(path, 1024 * 1024 * 128) {
                Ok(h) => h,
                Err(_) => continue,
            };
            let should_embed = qdrant::upsert_metadata(
                app,
                qdrant_state,
                qdrant::UpsertMetadataArgs {
                    source_id: source_id.to_string(),
                    path: path.to_string_lossy().to_string(),
                    content_hash: content_hash.clone(),
                },
            )
            .await?;
            if !should_embed.should_embed_content && !should_embed.should_embed_metadata {
                continue;
            }
            out.push(PendingEmbeddingFile {
                path: path.to_path_buf(),
                ext,
                mime,
                content_hash,
                should_embed_content: should_embed.should_embed_content,
                should_embed_metadata: should_embed.should_embed_metadata,
            });
        }
    }
    Ok(out)
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

#[derive(Clone)]
struct GeminiClient {
    http: reqwest::Client,
    api_key: String,
}

impl GeminiClient {
    fn new(api_key: String) -> Result<Self, String> {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(25))
            .build()
            .map_err(|e| e.to_string())?;
        Ok(Self { http, api_key })
    }
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

fn format_error_chain(err: &(dyn std::error::Error + 'static)) -> String {
    let mut parts = vec![err.to_string()];
    let mut source = err.source();
    while let Some(cause) = source {
        parts.push(cause.to_string());
        source = cause.source();
    }
    parts.join(": ")
}

async fn gemini_embed_post(client: &GeminiClient, body: serde_json::Value) -> Result<Vec<f32>, String> {
    async fn sleep_ms(ms: u64) {
        tokio::time::sleep(Duration::from_millis(ms)).await;
    }

    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/{}:embedContent",
        GEMINI_MODEL
    );

    let mut attempt = 0u32;
    let mut backoff_ms: u64 = 400;
    loop {
        attempt += 1;
        let res = client
            .http
            .post(&url)
            .header("Content-Type", "application/json")
            .header("x-goog-api-key", &client.api_key)
            .json(&body)
            .send()
            .await
            .map_err(|e| {
                tracing::error!(attempt, error = %e, "gemini embedContent request failed");
                format!("Gemini embedContent request failed: {e}")
            })?;

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
            tracing::error!(
                attempt,
                status = status.as_u16(),
                body = %text,
                "gemini embedContent retryable failure"
            );
            sleep_ms(backoff_ms).await;
            backoff_ms = std::cmp::min(5000, ((backoff_ms as f64) * 1.8).round() as u64);
            continue;
        }
        tracing::error!(
            attempt,
            status = status.as_u16(),
            body = %text,
            "gemini embedContent failed"
        );
        return Err(format!(
            "Gemini embedContent failed (HTTP {}): {}",
            status.as_u16(),
            text
        ));
    }
}

async fn embed_with_gemini(
    client: &GeminiClient,
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
    gemini_embed_post(client, body).await
}

async fn extract_text_with_gemini(
    client: &GeminiClient,
    mime_type: &str,
    bytes: Vec<u8>,
) -> Result<String, String> {
    let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
    let body = serde_json::json!({
        "contents": [{
            "parts": [
                { "text": "Extract all readable text. Return plain text only." },
                { "inline_data": { "mime_type": mime_type, "data": b64 } }
            ]
        }]
    });
    let url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";
    let res = client
        .http
        .post(url)
        .header("Content-Type", "application/json")
        .header("x-goog-api-key", &client.api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            let chain = format_error_chain(&e);
            tracing::error!(error = %chain, "gemini text extraction request failed");
            format!("Gemini text extraction request failed: {chain}")
        })?;
    let status = res.status();
    let text = res.text().await.unwrap_or_default();
    if !status.is_success() {
        let api_message = serde_json::from_str::<serde_json::Value>(&text)
            .ok()
            .and_then(|v| {
                v.get("error")
                    .and_then(|e| e.get("message"))
                    .and_then(|m| m.as_str())
                    .map(|s| s.to_string())
            });
        tracing::error!(
            status = status.as_u16(),
            api_message = ?api_message,
            body = %text,
            "gemini text extraction failed"
        );
        let details = api_message.unwrap_or(text);
        return Err(format!(
            "Gemini text extraction failed (HTTP {}): {}",
            status.as_u16(),
            details
        ));
    }
    let v: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let parts = v
        .get("candidates")
        .and_then(|c| c.as_array())
        .and_then(|arr| arr.first())
        .and_then(|c| c.get("content"))
        .and_then(|c| c.get("parts"))
        .and_then(|p| p.as_array())
        .cloned()
        .unwrap_or_default();
    let mut out = String::new();
    for p in parts {
        if let Some(t) = p.get("text").and_then(|x| x.as_str()) {
            if !out.is_empty() {
                out.push('\n');
            }
            out.push_str(t);
        }
    }
    Ok(out)
}

/// Embed a search query using the same API key env as file embedding (Rust-side).
pub async fn embed_query_text(text: &str) -> Result<Vec<f32>, String> {
    let api_key = read_gemini_api_key()?;
    let client = GeminiClient::new(api_key)?;
    embed_query_text_with_client(&client, text).await
}

async fn embed_query_text_with_client(client: &GeminiClient, text: &str) -> Result<Vec<f32>, String> {
    let body = serde_json::json!({
        "content": {
            "parts": [{ "text": text }]
        },
        "output_dimensionality": OUTPUT_DIM
    });
    gemini_embed_post(client, body).await
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
        let job_started = Instant::now();
        let mut last_emit = Instant::now();
        let gemini = match GeminiClient::new(api_key.clone()) {
            Ok(c) => c,
            Err(e) => {
                emit_error(&app2, &e);
                let mgr = app2.state::<EmbeddingManager>();
                let mut s = mgr.state.lock().await;
                s.running = false;
                s.phase = EmbeddingJobPhase::Error;
                s.message = e;
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
        };
        tracing::info!(
            source_id = %source_id,
            include_count = args.include.len(),
            exclude_count = args.exclude.len(),
            extensions_count = args.extensions.len(),
            "embedding job started"
        );

        let qdrant_state = app2.state::<qdrant::QdrantState>();
        let scan_started = Instant::now();
        let pending_files = match collect_pending_files(&app2, &qdrant_state, &args, &source_id).await {
            Ok(v) => v,
            Err(e) => {
                emit_error(&app2, &e);
                let mgr = app2.state::<EmbeddingManager>();
                let mut s = mgr.state.lock().await;
                s.running = false;
                s.phase = EmbeddingJobPhase::Error;
                s.message = e;
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
        };
        let total = pending_files.len() as u64;
        tracing::info!(
            source_id = %source_id,
            total_files = total,
            scan_elapsed_ms = scan_started.elapsed().as_millis(),
            "embedding pending scan completed"
        );
        {
            let mgr = app2.state::<EmbeddingManager>();
            let mut s = mgr.state.lock().await;
            s.total = total;
            s.phase = EmbeddingJobPhase::Embedding;
            s.message = if total == 0 {
                "No new or changed files to embed.".to_string()
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

        let mut processed: u64 = 0;
        for pending in pending_files {
            if cancel_flag.load(Ordering::Relaxed) {
                break;
            }
            if let Err(e) = wait_if_paused(&mut pause_rx, &cancel_flag).await {
                emit_error(&app2, &e);
                break;
            }

            let path = pending.path.as_path();
            let ext = pending.ext.clone();
            let mime = pending.mime;
            let sha256 = pending.content_hash;
            let file_path = path.to_string_lossy().to_string();
            let file_started = Instant::now();
            let bytes = if pending.should_embed_content {
                match std::fs::read(path) {
                    Ok(b) => Some(b),
                    Err(e) => {
                        emit_error(&app2, &e.to_string());
                        emit_file_failed(&app2, path, &format!("file read failed: {e}"));
                        continue;
                    }
                }
            } else {
                None
            };
                let content_embed_elapsed_ms: u128;
                let metadata_embed_elapsed_ms: u128;
                let text_extract_elapsed_ms: u128;
                let mime_owned = mime.map(|m| m.to_string());
                let metadata_text = metadata_text_for_path(path);
                let content_handle = {
                    let gemini = gemini.clone();
                    let mime = mime_owned.clone();
                    let bytes = bytes.clone();
                    tokio::spawn(async move {
                        if pending.should_embed_content {
                            if let (Some(mime), Some(raw)) = (mime, bytes) {
                                let started = Instant::now();
                                let embedding = embed_with_gemini(&gemini, &mime, raw).await?;
                                Ok::<(Option<Vec<f32>>, u128), String>((
                                    Some(embedding),
                                    started.elapsed().as_millis(),
                                ))
                            } else {
                                Ok::<(Option<Vec<f32>>, u128), String>((None, 0))
                            }
                        } else {
                            Ok::<(Option<Vec<f32>>, u128), String>((None, 0))
                        }
                    })
                };
                let metadata_handle = {
                    let gemini = gemini.clone();
                    tokio::spawn(async move {
                        if pending.should_embed_metadata {
                            let started = Instant::now();
                            let metadata_embedding =
                                embed_query_text_with_client(&gemini, &metadata_text).await?;
                            Ok::<(Option<Vec<f32>>, u128), String>((
                                Some(metadata_embedding),
                                started.elapsed().as_millis(),
                            ))
                        } else {
                            Ok::<(Option<Vec<f32>>, u128), String>((None, 0))
                        }
                    })
                };
                let text_handle = {
                    let gemini = gemini.clone();
                    let mime = mime_owned;
                    tokio::spawn(async move {
                        if pending.should_embed_content && supports_text_extraction(&ext) {
                            if let (Some(mime), Some(raw)) = (mime, bytes) {
                                let started = Instant::now();
                                let extracted = extract_text_with_gemini(&gemini, &mime, raw).await.ok();
                                Ok::<(Option<String>, u128), String>((
                                    extracted,
                                    started.elapsed().as_millis(),
                                ))
                            } else {
                                Ok::<(Option<String>, u128), String>((None, 0))
                            }
                        } else {
                            Ok::<(Option<String>, u128), String>((None, 0))
                        }
                    })
                };

                let content_res = match content_handle.await {
                    Ok(v) => v,
                    Err(e) => Err(format!("content embedding task failed: {e}")),
                };
                let metadata_res = match metadata_handle.await {
                    Ok(v) => v,
                    Err(e) => Err(format!("metadata embedding task failed: {e}")),
                };
                let text_res = match text_handle.await {
                    Ok(v) => v,
                    Err(e) => Err(format!("text extraction task failed: {e}")),
                };

                let (content_embedding, content_elapsed) = match content_res {
                    Ok(v) => v,
                    Err(e) => {
                        emit_error(&app2, &e);
                        emit_file_failed(&app2, path, &format!("embedding request failed: {e}"));
                        continue;
                    }
                };
                content_embed_elapsed_ms = content_elapsed;

                let (metadata_embedding, metadata_elapsed) = match metadata_res {
                    Ok(v) => v,
                    Err(e) => {
                        emit_error(&app2, &e);
                        emit_file_failed(&app2, path, &format!("metadata embedding failed: {e}"));
                        continue;
                    }
                };
                metadata_embed_elapsed_ms = metadata_elapsed;

                let (extracted_text, text_elapsed) = match text_res {
                    Ok(v) => v,
                    Err(_) => (None, 0),
                };
                text_extract_elapsed_ms = text_elapsed;

                if let Some(embedding) = content_embedding {
                    if let Err(e) = qdrant::upsert_embedding(
                        &app2,
                        &qdrant_state,
                        qdrant::UpsertEmbeddingArgs {
                            source_id: source_id.clone(),
                            path: file_path.clone(),
                            content_hash: sha256.clone(),
                            embedding,
                        },
                    )
                    .await
                    {
                        emit_error(&app2, &e);
                        emit_file_failed(&app2, path, &format!("vector upsert failed: {e}"));
                        continue;
                    }
                }

                if let Some(metadata_embedding) = metadata_embedding {
                    if let Err(e) = qdrant::upsert_metadata_embedding(
                        &app2,
                        &qdrant_state,
                        qdrant::UpsertMetadataEmbeddingArgs {
                            source_id: source_id.clone(),
                            path: file_path.clone(),
                            content_hash: sha256.clone(),
                            metadata_embedding,
                        },
                    )
                    .await
                    {
                        emit_error(&app2, &e);
                        emit_file_failed(&app2, path, &format!("metadata vector upsert failed: {e}"));
                        continue;
                    }
                }

                let direct_match_text = match extracted_text {
                    Some(extracted) if !extracted.trim().is_empty() => {
                        format!("{metadata_text}\n{extracted}")
                    }
                    _ => metadata_text.clone(),
                };
                let normalized = text_index::normalize_text(&direct_match_text);
                if !normalized.is_empty() {
                    let _ = text_index::upsert_text(
                        &app2,
                        text_index::UpsertTextArgs {
                            source_id: source_id.clone(),
                            path: file_path.clone(),
                            content_hash: sha256.clone(),
                            normalized_text: normalized,
                        },
                    );
                }
                tracing::info!(
                    path = %file_path,
                    source_id = %source_id,
                    should_embed_content = pending.should_embed_content,
                    should_embed_metadata = pending.should_embed_metadata,
                    content_embed_elapsed_ms,
                    metadata_embed_elapsed_ms,
                    text_extract_elapsed_ms,
                    file_total_elapsed_ms = file_started.elapsed().as_millis(),
                    "embedding file completed"
                );

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
        tracing::info!(
            source_id = %source_id,
            processed_files = processed,
            cancelled,
            total_elapsed_ms = job_started.elapsed().as_millis(),
            "embedding job finished"
        );
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

