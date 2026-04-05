use crate::{
    compute_sha256, walk_scan_candidates, MAX_EMBED_FILE_BYTES, ScanFilesArgs,
};
use crate::qdrant;
use crate::text_index;
use base64::Engine;
use image::codecs::jpeg::JpegEncoder;
use image::ImageEncoder;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};
use tokio::sync::{watch, Mutex, Semaphore};
use lru::LruCache;
use std::num::NonZeroUsize;

const OUTPUT_DIM: usize = 3072;
const GEMINI_MODEL: &str = "models/gemini-embedding-2-preview";
const GEMINI_OCR_MODEL: &str = "models/gemini-3-flash-preview";
const GEMINI_EMBED_TIMEOUT_SECS: u64 = 120;
/// Shorter than before: raster inputs are downscaled before OCR.
const GEMINI_OCR_TIMEOUT_SECS: u64 = 90;
const GEMINI_OCR_HTTP_MAX_ATTEMPTS: u32 = 5;
const EMBED_VISION_MAX_EDGE: u32 = 1536;
const EMBED_VISION_JPEG_QUALITY: u8 = 85;
const PDF_LOCAL_TEXT_MIN_NONSPACE: usize = 48;
const VISION_GEMINI_MAX_IN_FLIGHT: usize = 8;

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
    gemini_client: Option<GeminiClient>,
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
                gemini_client: None,
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

    pub async fn get_gemini_client(&self) -> Result<GeminiClient, String> {
        let mut s = self.state.lock().await;
        if let Some(client) = &s.gemini_client {
            return Ok(client.clone());
        }
        let api_key = read_gemini_api_key()?;
        let client = GeminiClient::new(api_key)?;
        s.gemini_client = Some(client.clone());
        Ok(client)
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

fn emit_status(app: &tauri::AppHandle, status: &EmbeddingJobStatus) {
    let _ = app.emit("embedding://status", status);
}

fn emit_error(app: &tauri::AppHandle, message: &str) {
    if message == "Cancelled" {
        tracing::info!(
            target: crate::logging::TARGET_EMBEDDING,
            "embedding job cancelled"
        );
    } else {
        tracing::error!(
            target: crate::logging::TARGET_EMBEDDING,
            message = %message,
            "embedding job error"
        );
    }
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
    size_bytes: u64,
    mtime_ms: i64,
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
    cancel_flag: &Arc<AtomicBool>,
) -> Result<Vec<PendingEmbeddingFile>, String> {
    let args_clone = args.clone();
    let candidates = tokio::task::spawn_blocking(move || {
        walk_scan_candidates(&args_clone, MAX_EMBED_FILE_BYTES)
    })
    .await
    .map_err(|e| format!("collect_pending_files: walk join error: {e}"))??;

    let index = qdrant::load_source_preflight_index(app, qdrant_state, source_id).await?;

    let mut out: Vec<PendingEmbeddingFile> = Vec::new();
    for c in candidates {
        if cancel_flag.load(Ordering::Relaxed) {
            return Ok(Vec::new());
        }
        let path_str = c.path.to_string_lossy().to_string();
        let content_hash = if let Some(h) = qdrant::reuse_hash_if_fingerprint_matches(
            &path_str,
            c.size_bytes,
            c.mtime_ms,
            &index,
        ) {
            h
        } else {
            match compute_sha256(&c.path, 1024 * 1024 * 128) {
                Ok(h) => h,
                Err(_) => continue,
            }
        };
        let should_embed =
            qdrant::decide_embedding_need_from_index(&path_str, &content_hash, &index);
        if !should_embed.should_embed_content && !should_embed.should_embed_metadata {
            continue;
        }
        let mime = mime_type_for_ext(&c.ext);
        out.push(PendingEmbeddingFile {
            path: c.path,
            ext: c.ext,
            mime,
            content_hash,
            should_embed_content: should_embed.should_embed_content,
            should_embed_metadata: should_embed.should_embed_metadata,
            size_bytes: c.size_bytes,
            mtime_ms: c.mtime_ms,
        });
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
pub struct GeminiClient {
    http: reqwest::Client,
    api_key: String,
    query_cache: Arc<Mutex<LruCache<String, Vec<f32>>>>,
}

impl GeminiClient {
    fn new(api_key: String) -> Result<Self, String> {
        let http = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(15))
            .build()
            .map_err(|e| e.to_string())?;
        let query_cache = Arc::new(Mutex::new(LruCache::new(NonZeroUsize::new(128).unwrap())));
        Ok(Self { http, api_key, query_cache })
    }
}

impl std::fmt::Debug for GeminiClient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("GeminiClient")
            .field("api_key", &"REDACTED")
            .finish()
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

/// Downscale and JPEG-encode raster images to reduce upload size and OCR latency.
pub fn prepare_raster_image_for_gemini(bytes: &[u8]) -> Result<(Vec<u8>, &'static str), String> {
    let img = image::load_from_memory(bytes).map_err(|e| e.to_string())?;
    let thumb = img.thumbnail(EMBED_VISION_MAX_EDGE, EMBED_VISION_MAX_EDGE);
    let rgb = thumb.to_rgb8();
    let mut buf = Vec::new();
    let enc = JpegEncoder::new_with_quality(&mut buf, EMBED_VISION_JPEG_QUALITY);
    enc.write_image(
        rgb.as_raw(),
        rgb.width(),
        rgb.height(),
        image::ExtendedColorType::Rgb8,
    )
    .map_err(|e| e.to_string())?;
    Ok((buf, "image/jpeg"))
}

fn truncate_for_log(s: &str, max_chars: usize) -> String {
    if s.chars().count() <= max_chars {
        return s.to_string();
    }
    let mut out = String::new();
    for (i, ch) in s.chars().enumerate() {
        if i >= max_chars {
            break;
        }
        out.push(ch);
    }
    out.push_str("...(truncated)");
    out
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
        let started = Instant::now();
        let res = match client
            .http
            .post(&url)
            .header("Content-Type", "application/json")
            .header("x-goog-api-key", &client.api_key)
            .timeout(Duration::from_secs(GEMINI_EMBED_TIMEOUT_SECS))
            .json(&body)
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => {
                let elapsed_ms = started.elapsed().as_millis() as u64;
                let chain = format_error_chain(&e);
                let should_retry = attempt < 5;
                tracing::error!(
                    target: crate::logging::TARGET_EMBEDDING,
                    attempt,
                    elapsed_ms,
                    will_retry = should_retry,
                    error = %chain,
                    "gemini embedContent request failed before HTTP response"
                );
                if should_retry {
                    sleep_ms(backoff_ms).await;
                    backoff_ms = std::cmp::min(5000, ((backoff_ms as f64) * 1.8).round() as u64);
                    continue;
                }
                return Err(format!(
                    "Gemini embedContent request failed after {}ms: {}",
                    elapsed_ms, chain
                ));
            }
        };

        let status = res.status();
        let elapsed_ms = started.elapsed().as_millis() as u64;
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
                target: crate::logging::TARGET_EMBEDDING,
                attempt,
                elapsed_ms,
                status = status.as_u16(),
                body = %text,
                "gemini embedContent retryable failure"
            );
            sleep_ms(backoff_ms).await;
            backoff_ms = std::cmp::min(5000, ((backoff_ms as f64) * 1.8).round() as u64);
            continue;
        }
        tracing::error!(
            target: crate::logging::TARGET_EMBEDDING,
            attempt,
            elapsed_ms,
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

fn parse_generate_content_plain_text(response_body: &str) -> Result<String, String> {
    let v: serde_json::Value = serde_json::from_str(response_body).map_err(|e| e.to_string())?;
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

async fn extract_text_with_gemini(
    client: &GeminiClient,
    file_path: &str,
    mime_type: &str,
    bytes: Vec<u8>,
) -> Result<String, String> {
    async fn sleep_ms(ms: u64) {
        tokio::time::sleep(Duration::from_millis(ms)).await;
    }

    let input_size_bytes = bytes.len();
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    let body = serde_json::json!({
        "contents": [{
            "parts": [
                {
                    "text": "Extract all readable text from this file and return plain text only. Do not add explanations, labels, markdown, or commentary."
                },
                { "inline_data": { "mime_type": mime_type, "data": b64 } }
            ]
        }],
        "generationConfig": {
            "temperature": 0,
            "responseMimeType": "text/plain"
        }
    });
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/{}:generateContent",
        GEMINI_OCR_MODEL
    );

    let mut attempt = 0u32;
    let mut backoff_ms: u64 = 800;
    loop {
        attempt += 1;
        let attempt_started = Instant::now();
        let res = match client
            .http
            .post(&url)
            .header("Content-Type", "application/json")
            .header("x-goog-api-key", &client.api_key)
            .timeout(Duration::from_secs(GEMINI_OCR_TIMEOUT_SECS))
            .json(&body)
            .send()
            .await
        {
            Ok(res) => res,
            Err(e) => {
                let attempt_elapsed_ms = attempt_started.elapsed().as_millis();
                let chain = format_error_chain(&e);
                let should_retry = attempt < GEMINI_OCR_HTTP_MAX_ATTEMPTS;
                tracing::error!(
                    target: crate::logging::TARGET_EMBEDDING,
                    file_path = %file_path,
                    mime_type = %mime_type,
                    model = GEMINI_OCR_MODEL,
                    url = %url,
                    input_size_bytes,
                    attempt,
                    attempt_elapsed_ms,
                    timeout_secs = GEMINI_OCR_TIMEOUT_SECS,
                    will_retry = should_retry,
                    error = %chain,
                    "gemini text extraction request failed before HTTP response"
                );
                if should_retry {
                    sleep_ms(backoff_ms).await;
                    backoff_ms = std::cmp::min(6000, ((backoff_ms as f64) * 1.8).round() as u64);
                    continue;
                }
                return Err(format!(
                    "Gemini text extraction request failed for {} ({}): {} (no HTTP response)",
                    file_path, mime_type, chain
                ));
            }
        };

        let status = res.status();
        let headers = format!("{:?}", res.headers());
        let text = res.text().await.unwrap_or_default();
        let elapsed_ms = attempt_started.elapsed().as_millis() as u64;

        if status.is_success() {
            tracing::debug!(
                target: crate::logging::TARGET_EMBEDDING,
                file_path = %file_path,
                input_size_bytes,
                attempt,
                elapsed_ms,
                "gemini text extraction succeeded"
            );
            return parse_generate_content_plain_text(&text);
        }

        let api_message = serde_json::from_str::<serde_json::Value>(&text)
            .ok()
            .and_then(|v| {
                v.get("error")
                    .and_then(|e| e.get("message"))
                    .and_then(|m| m.as_str())
                    .map(|s| s.to_string())
            });
        let retryable = matches!(status.as_u16(), 429 | 500 | 503);
        if retryable && attempt < GEMINI_OCR_HTTP_MAX_ATTEMPTS {
            tracing::error!(
                target: crate::logging::TARGET_EMBEDDING,
                file_path = %file_path,
                mime_type = %mime_type,
                model = GEMINI_OCR_MODEL,
                url = %url,
                status = status.as_u16(),
                headers = %headers,
                api_message = ?api_message,
                body = %truncate_for_log(&text, 4000),
                attempt,
                elapsed_ms,
                "gemini text extraction retryable HTTP failure"
            );
            sleep_ms(backoff_ms).await;
            backoff_ms = std::cmp::min(6000, ((backoff_ms as f64) * 1.8).round() as u64);
            continue;
        }

        tracing::error!(
            target: crate::logging::TARGET_EMBEDDING,
            file_path = %file_path,
            mime_type = %mime_type,
            model = GEMINI_OCR_MODEL,
            url = %url,
            status = status.as_u16(),
            headers = %headers,
            api_message = ?api_message,
            body = %truncate_for_log(&text, 4000),
            "gemini text extraction failed"
        );
        let details = api_message.unwrap_or(text);
        return Err(format!(
            "Gemini text extraction failed for {} (HTTP {}): {}",
            file_path,
            status.as_u16(),
            details
        ));
    }
}

/// Embed a search query using the same API key env as file embedding (Rust-side).
pub async fn embed_query_text(app: &tauri::AppHandle, text: &str) -> Result<Vec<f32>, String> {
    let mgr = app.state::<EmbeddingManager>();
    let client = mgr.get_gemini_client().await?;
    embed_query_text_with_client(&client, text).await
}

async fn embed_query_text_with_client(client: &GeminiClient, text: &str) -> Result<Vec<f32>, String> {
    {
        let mut cache = client.query_cache.lock().await;
        if let Some(v) = cache.get(text) {
            return Ok(v.clone());
        }
    }

    let body = serde_json::json!({
        "content": {
            "parts": [{ "text": text }]
        },
        "output_dimensionality": OUTPUT_DIM
    });
    let v = gemini_embed_post(client, body).await?;

    {
        let mut cache = client.query_cache.lock().await;
        cache.put(text.to_string(), v.clone());
    }

    Ok(v)
}

pub async fn judge_tag(
    app: &tauri::AppHandle,
    tag_name: &str,
    similarity_score: f32,
    labeled_path: &str,
    candidate_path: &str,
    source_part: serde_json::Value,
    target_part: serde_json::Value,
) -> Result<bool, String> {
    let mgr = app.state::<EmbeddingManager>();
    let client = mgr.get_gemini_client().await?;

    // Value is Qdrant search score for Distance::Cosine (cosine similarity): higher = more similar.
    let prompt = format!(
        "You are evaluating if two files belong to the same category/tag based on their content. The tag is: '{}'. The embedding cosine similarity score between these two files is {} (higher is more similar). Do these files both belong to the tag '{}'? Answer strictly YES or NO.",
        tag_name, similarity_score, tag_name
    );

    tracing::info!(
        target: crate::logging::TARGET_JUDGE,
        "judge_tag labeled='{}' candidate='{}'",
        labeled_path,
        candidate_path
    );

    let body = serde_json::json!({
        "contents": [{
            "parts": [
                { "text": prompt },
                { "text": "File 1:" },
                source_part,
                { "text": "File 2:" },
                target_part
            ]
        }],
        "generationConfig": {
            "temperature": 0,
            "responseMimeType": "text/plain"
        }
    });

    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/{}:generateContent",
        GEMINI_OCR_MODEL
    );

    let res = client
        .http
        .post(&url)
        .header("x-goog-api-key", &client.api_key)
        .header("Content-Type", "application/json")
        .json(&body)
        .timeout(std::time::Duration::from_secs(60))
        .send()
        .await
        .map_err(|e| format!("Gemini judge tag request failed: {}", e))?;

    if !res.status().is_success() {
        let status = res.status();
        let body_text = res.text().await.unwrap_or_default();
        return Err(format!("Gemini judge tag failed (HTTP {}): {}", status, body_text));
    }

    let json: serde_json::Value = res.json().await.map_err(|e| format!("Invalid JSON: {}", e))?;
    if let Some(text) = json["candidates"][0]["content"]["parts"][0]["text"].as_str() {
        let text = text.trim().to_uppercase();
        Ok(text.contains("YES"))
    } else {
        Err("Gemini response missing text".to_string())
    }
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
            target: crate::logging::TARGET_EMBEDDING,
            source_id = %source_id,
            include_count = args.include.len(),
            exclude_count = args.exclude.len(),
            extensions_count = args.extensions.len(),
            "embedding job started"
        );

        let qdrant_state = app2.state::<qdrant::QdrantState>();
        let scan_started = Instant::now();
        let pending_files = match collect_pending_files(
            &app2,
            &qdrant_state,
            &args,
            &source_id,
            &cancel_flag,
        )
        .await
        {
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
            target: crate::logging::TARGET_EMBEDDING,
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
        let max_parallelism = std::thread::available_parallelism()
            .map(|n| (n.get() * 2).clamp(2, 16))
            .unwrap_or(8);
        tracing::info!(
            target: crate::logging::TARGET_EMBEDDING,
            source_id = %source_id,
            max_parallelism,
            vision_gemini_max_in_flight = VISION_GEMINI_MAX_IN_FLIGHT,
            "embedding parallel workers configured"
        );
        let pdfium_candidates = Arc::new(crate::pdfium_library_candidates(&app2));
        let vision_sem = Arc::new(Semaphore::new(VISION_GEMINI_MAX_IN_FLIGHT));
        let mut join_set = tokio::task::JoinSet::new();
        for pending in pending_files {
            if cancel_flag.load(Ordering::Relaxed) {
                break;
            }
            if let Err(e) = wait_if_paused(&mut pause_rx, &cancel_flag).await {
                emit_error(&app2, &e);
                break;
            }
            while join_set.len() >= max_parallelism {
                let Some(joined) = join_set.join_next().await else {
                    break;
                };
                let completed = joined.unwrap_or(false);
                processed = processed.saturating_add(1);
                let mgr = app2.state::<EmbeddingManager>();
                let mut s = mgr.state.lock().await;
                s.processed = processed;
                s.phase = if *pause_rx.borrow() {
                    EmbeddingJobPhase::Paused
                } else {
                    EmbeddingJobPhase::Embedding
                };
                s.message = if completed {
                    "Embedding in progress…".to_string()
                } else {
                    "Embedding in progress (some files failed)…".to_string()
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
            let app_for_file = app2.clone();
            let source_id_for_file = source_id.clone();
            let gemini_for_file = gemini.clone();
            let pdfium_for_job = pdfium_candidates.clone();
            let vision_sem_for_job = vision_sem.clone();
            join_set.spawn(async move {
                let path = pending.path.as_path();
                let ext = pending.ext.clone();
                let mime = pending.mime;
                let sha256 = pending.content_hash;
                let size_bytes = pending.size_bytes;
                let mtime_ms = pending.mtime_ms;
                let file_path = path.to_string_lossy().to_string();
                let file_started = Instant::now();
                let bytes = if pending.should_embed_content {
                    match std::fs::read(path) {
                        Ok(b) => Some(b),
                        Err(e) => {
                            emit_file_failed(&app_for_file, path, &format!("file read failed: {e}"));
                            return false;
                        }
                    }
                } else {
                    None
                };
                let file_read_bytes = bytes.as_ref().map(|b| b.len()).unwrap_or(0);
                let (gemini_vision_bytes, gemini_vision_mime): (Option<Vec<u8>>, Option<String>) =
                    match (&bytes, ext.as_str()) {
                        (Some(raw), "png" | "jpg" | "jpeg") => {
                            match prepare_raster_image_for_gemini(raw) {
                                Ok((b, m)) => (Some(b), Some(m.to_string())),
                                Err(e) => {
                                    tracing::warn!(
                                        target: crate::logging::TARGET_EMBEDDING,
                                        path = %file_path,
                                        error = %e,
                                        "gemini vision image preprocess failed; sending original bytes"
                                    );
                                    (Some(raw.clone()), mime.map(|m| m.to_string()))
                                }
                            }
                        }
                        (Some(raw), _) => (Some(raw.clone()), mime.map(|m| m.to_string())),
                        _ => (None, None),
                    };
                let gemini_vision_payload_bytes =
                    gemini_vision_bytes.as_ref().map(|v| v.len()).unwrap_or(0);
                let content_embed_elapsed_ms: u128;
                let metadata_embed_elapsed_ms: u128;
                let text_extract_elapsed_ms: u128;
                let metadata_text = metadata_text_for_path(path);
                let metadata_text_for_embedding = metadata_text.clone();
                let content_handle = {
                    let gemini = gemini_for_file.clone();
                    let mime = gemini_vision_mime.clone();
                    let raw = gemini_vision_bytes.clone();
                    let vision_sem = vision_sem_for_job.clone();
                    tokio::spawn(async move {
                        if pending.should_embed_content {
                            if let (Some(mime), Some(raw)) = (mime, raw) {
                                let _permit = vision_sem
                                    .acquire()
                                    .await
                                    .map_err(|e| e.to_string())?;
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
                    let gemini = gemini_for_file.clone();
                    let metadata_text = metadata_text_for_embedding;
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
                    let gemini = gemini_for_file.clone();
                    let mime = gemini_vision_mime.clone();
                    let raw = gemini_vision_bytes.clone();
                    let file_path_for_text = file_path.clone();
                    let ext_for_text = ext.clone();
                    let path_for_pdf = pending.path.clone();
                    let pdfium_c = pdfium_for_job.clone();
                    let vision_sem = vision_sem_for_job.clone();
                    tokio::spawn(async move {
                        if !(pending.should_embed_content && supports_text_extraction(&ext_for_text))
                        {
                            return Ok::<(Option<String>, u128, bool), String>((None, 0, false));
                        }
                        let started = Instant::now();
                        if ext_for_text == "pdf" {
                            let path = path_for_pdf.clone();
                            let cands = pdfium_c.as_ref().clone();
                            let local_res = tokio::task::spawn_blocking(move || {
                                crate::extract_pdf_text_pdfium(&path, &cands)
                            })
                            .await;
                            match local_res {
                                Ok(Ok(local)) => {
                                    let nonspace =
                                        local.chars().filter(|c| !c.is_whitespace()).count();
                                    if nonspace >= PDF_LOCAL_TEXT_MIN_NONSPACE {
                                        tracing::debug!(
                                            target: crate::logging::TARGET_EMBEDDING,
                                            path = %file_path_for_text,
                                            nonspace,
                                            "pdf text extraction used local PDFium text"
                                        );
                                        return Ok((
                                            Some(local),
                                            started.elapsed().as_millis(),
                                            true,
                                        ));
                                    }
                                }
                                Ok(Err(e)) => {
                                    tracing::debug!(
                                        target: crate::logging::TARGET_EMBEDDING,
                                        path = %file_path_for_text,
                                        error = %e,
                                        "pdf local text extraction failed; falling back to Gemini OCR"
                                    );
                                }
                                Err(e) => {
                                    tracing::debug!(
                                        target: crate::logging::TARGET_EMBEDDING,
                                        path = %file_path_for_text,
                                        error = %e,
                                        "pdf local text extraction task failed; falling back to Gemini OCR"
                                    );
                                }
                            }
                        }
                        if let (Some(mime), Some(raw)) = (mime, raw) {
                            let _permit = vision_sem
                                .acquire()
                                .await
                                .map_err(|e| e.to_string())?;
                            let extracted = extract_text_with_gemini(
                                &gemini,
                                &file_path_for_text,
                                &mime,
                                raw,
                            )
                            .await
                            .ok();
                            Ok((extracted, started.elapsed().as_millis(), false))
                        } else {
                            Ok((None, started.elapsed().as_millis(), false))
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
                        emit_file_failed(&app_for_file, path, &format!("embedding request failed: {e}"));
                        return false;
                    }
                };
                content_embed_elapsed_ms = content_elapsed;

                let (metadata_embedding, metadata_elapsed) = match metadata_res {
                    Ok(v) => v,
                    Err(e) => {
                        emit_file_failed(&app_for_file, path, &format!("metadata embedding failed: {e}"));
                        return false;
                    }
                };
                metadata_embed_elapsed_ms = metadata_elapsed;

                let (extracted_text, text_elapsed, pdf_used_local_text) = match text_res {
                    Ok(v) => v,
                    Err(_) => (None, 0, false),
                };
                text_extract_elapsed_ms = text_elapsed;

                let qdrant_state = app_for_file.state::<qdrant::QdrantState>();
                if let Some(embedding) = content_embedding {
                    if let Err(e) = qdrant::upsert_embedding(
                        &app_for_file,
                        &qdrant_state,
                        qdrant::UpsertEmbeddingArgs {
                            source_id: source_id_for_file.clone(),
                            path: file_path.clone(),
                            content_hash: sha256.clone(),
                            size_bytes,
                            mtime_ms,
                            embedding,
                        },
                    )
                    .await
                    {
                        emit_file_failed(&app_for_file, path, &format!("vector upsert failed: {e}"));
                        return false;
                    }
                }

                if let Some(metadata_embedding) = metadata_embedding {
                    if let Err(e) = qdrant::upsert_metadata_embedding(
                        &app_for_file,
                        &qdrant_state,
                        qdrant::UpsertMetadataEmbeddingArgs {
                            source_id: source_id_for_file.clone(),
                            path: file_path.clone(),
                            content_hash: sha256.clone(),
                            size_bytes,
                            mtime_ms,
                            metadata_embedding,
                        },
                    )
                    .await
                    {
                        emit_file_failed(
                            &app_for_file,
                            path,
                            &format!("metadata vector upsert failed: {e}"),
                        );
                        return false;
                    }
                }

                let direct_match_text = match extracted_text {
                    Some(extracted) if !extracted.trim().is_empty() => {
                        format!("{metadata_text}\n{extracted}")
                    }
                    _ => metadata_text.clone(),
                };
                if !direct_match_text.trim().is_empty() {
                    let text_index_state = app_for_file.state::<text_index::TextIndexState>();
                    let _ = text_index::upsert_text(
                        &app_for_file,
                        &text_index_state,
                        text_index::UpsertTextArgs {
                            source_id: source_id_for_file.clone(),
                            path: file_path.clone(),
                            content_hash: sha256.clone(),
                            raw_text: direct_match_text,
                        },
                    ).await;
                }
                tracing::info!(
                    target: crate::logging::TARGET_EMBEDDING,
                    path = %file_path,
                    source_id = %source_id_for_file,
                    should_embed_content = pending.should_embed_content,
                    should_embed_metadata = pending.should_embed_metadata,
                    content_embed_elapsed_ms,
                    metadata_embed_elapsed_ms,
                    text_extract_elapsed_ms,
                    file_read_bytes,
                    gemini_vision_payload_bytes,
                    pdf_used_local_text,
                    file_total_elapsed_ms = file_started.elapsed().as_millis(),
                    "embedding file completed"
                );
                true
            });
        }

        while let Some(joined) = join_set.join_next().await {
            let completed = joined.unwrap_or(false);
            // Count every finished file task (success or failure) so UI progress reflects real-time completion.
            processed = processed.saturating_add(1);
            let mgr = app2.state::<EmbeddingManager>();
            let mut s = mgr.state.lock().await;
            s.processed = processed;
            s.phase = if *pause_rx.borrow() {
                EmbeddingJobPhase::Paused
            } else {
                EmbeddingJobPhase::Embedding
            };
            s.message = if completed {
                "Embedding in progress…".to_string()
            } else {
                "Embedding in progress (some files failed)…".to_string()
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
            target: crate::logging::TARGET_EMBEDDING,
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

