use base64::Engine;
use pdfium_render::prelude::*;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::Manager;
use walkdir::WalkDir;

mod qdrant;
mod embedding;
mod text_index;

const THUMB_CACHE_MAX_ENTRIES: usize = 512;
const THUMB_CACHE_SCHEMA_VERSION: &str = "v2";

#[derive(Debug, Clone)]
struct ThumbnailCacheEntry {
    mtime_ms: i64,
    size_bytes: u64,
    png_base64: String,
}

#[derive(Debug, Default)]
struct ThumbnailCache {
    // Small in-memory cache to avoid repeating expensive image decode/resize
    // across searches for the same files.
    entries: Mutex<HashMap<String, ThumbnailCacheEntry>>,
}

fn thumbnail_cache_key(path: &str, max_edge: u32, page: u16) -> String {
    format!("{path}::{page}::{max_edge}")
}

fn thumbnail_fingerprint(mtime_ms: i64, size_bytes: u64) -> String {
    format!("{mtime_ms}:{size_bytes}")
}

fn thumbnail_disk_cache_path(
    app: &tauri::AppHandle,
    cache_key: &str,
    fingerprint: &str,
) -> Result<PathBuf, String> {
    let mut dir = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    dir.push("thumbnails");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    hasher.update(THUMB_CACHE_SCHEMA_VERSION.as_bytes());
    hasher.update(cache_key.as_bytes());
    hasher.update(fingerprint.as_bytes());
    let file_name = format!("{}.b64", hex::encode(hasher.finalize()));
    Ok(dir.join(file_name))
}

fn load_disk_thumbnail_base64(
    app: &tauri::AppHandle,
    cache_key: &str,
    fingerprint: &str,
) -> Result<Option<String>, String> {
    let path = thumbnail_disk_cache_path(app, cache_key, fingerprint)?;
    match fs::read_to_string(path) {
        Ok(data) => Ok(Some(data)),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(err.to_string()),
    }
}

fn store_disk_thumbnail_base64(
    app: &tauri::AppHandle,
    cache_key: &str,
    fingerprint: &str,
    png_base64: &str,
) -> Result<(), String> {
    let path = thumbnail_disk_cache_path(app, cache_key, fingerprint)?;
    fs::write(path, png_base64.as_bytes()).map_err(|e| e.to_string())
}

fn thumbnail_file_kind(path: &Path) -> String {
    path.extension()
        .and_then(|s| s.to_str())
        .map(normalize_ext)
        .unwrap_or_default()
}

fn render_image_thumbnail_base64(path: &Path, max_edge: u32) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    let img = image::load_from_memory(&bytes).map_err(|e| e.to_string())?;
    let resized = img.thumbnail(max_edge, max_edge);
    let mut out = Vec::new();
    resized
        .write_to(&mut std::io::Cursor::new(&mut out), image::ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    Ok(base64::engine::general_purpose::STANDARD.encode(out))
}

fn load_pdfium(candidates: &[PathBuf]) -> Result<Pdfium, String> {
    let mut attempted: Vec<String> = Vec::new();
    for dir in candidates {
        let lib_path = Pdfium::pdfium_platform_library_name_at_path(dir);
        attempted.push(lib_path.display().to_string());
        if let Ok(bindings) = Pdfium::bind_to_library(&lib_path) {
            return Ok(Pdfium::new(bindings));
        }
    }
    let bindings = Pdfium::bind_to_system_library().map_err(|e| {
        let attempted_list = if attempted.is_empty() {
            "none".to_string()
        } else {
            attempted.join(", ")
        };
        format!(
            "pdf thumbnail renderer unavailable: could not load PDFium from candidates [{attempted_list}] or system library ({e}). Install PDFium or bundle it for this platform."
        )
    })?;
    Ok(Pdfium::new(bindings))
}

fn render_pdf_thumbnail_base64(
    path: &Path,
    max_edge: u32,
    page: u16,
    pdfium_candidates: &[PathBuf],
) -> Result<String, String> {
    let pdfium = load_pdfium(pdfium_candidates)?;
    let document = pdfium.load_pdf_from_file(path, None).map_err(|e| e.to_string())?;
    let page = document
        .pages()
        .iter()
        .nth(page as usize)
        .ok_or_else(|| format!("pdf page out of range: {page}"))?;

    let rendered = page
        .render_with_config(
            &PdfRenderConfig::new()
                .set_target_width(max_edge as i32)
                .set_maximum_height(max_edge as i32),
        )
        .map_err(|e| e.to_string())?;
    let image = rendered.as_image();
    let mut out = Vec::new();
    image
        .write_to(&mut std::io::Cursor::new(&mut out), image::ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    Ok(base64::engine::general_purpose::STANDARD.encode(out))
}

fn load_env() {
    let _ = dotenvy::from_filename(".env.local");
    let _ = dotenvy::from_filename("../.env.local");
    let _ = dotenvy::dotenv();
}

fn init_logging() {
    // Error-only logging by default.
    let filter = std::env::var("MANIFOLD_LOG")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .or_else(|| std::env::var("RUST_LOG").ok())
        .unwrap_or_else(|| "error".to_string());

    let env_filter = tracing_subscriber::EnvFilter::try_new(filter)
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("error"));

    let _ = tracing_subscriber::fmt()
        .with_env_filter(env_filter)
        .with_target(true)
        .with_line_number(true)
        .with_file(true)
        .compact()
        .try_init();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    load_env();
    init_logging();
    let app = tauri::Builder::default()
        .manage(qdrant::QdrantState::default())
        .manage(embedding::EmbeddingManager::default())
        .manage(text_index::TextIndexState::default())
        .manage(ThumbnailCache::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let qdrant_state = app_handle.state::<qdrant::QdrantState>();
                let _ = qdrant::ensure_started(&app_handle, &qdrant_state).await;
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            scan_files,
            scan_files_count,
            scan_files_estimate,
            scan_files_needs_embedding,
            read_file_base64,
            thumbnail_image_base64_png,
            qdrant_status,
            qdrant_upsert_metadata,
            qdrant_upsert_embedding,
            qdrant_semantic_search,
            hybrid_search,
            qdrant_count_points,
            qdrant_delete_all_points,
            qdrant_delete_points_for_paths,
            start_embedding_job,
            pause_embedding_job,
            resume_embedding_job,
            cancel_embedding_job,
            embedding_job_status,
            embed_query_text,
            text_index_full_text_for_path
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");
    app.run(|app_handle, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            tauri::async_runtime::block_on(async move {
                let qdrant_state = app_handle.state::<qdrant::QdrantState>();
                qdrant::shutdown(&qdrant_state).await;
            });
        }
    });
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanFilesArgs {
    pub include: Vec<String>,
    pub exclude: Vec<String>,
    pub extensions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScannedFile {
    pub path: String,
    pub size_bytes: u64,
    pub mtime_ms: i64,
    pub sha256: String,
}

fn is_under_dir(path: &Path, dir: &Path) -> bool {
    path.starts_with(dir)
}

fn is_walk_permission_denied(err: &walkdir::Error) -> bool {
    use std::io::ErrorKind;
    err.io_error()
        .is_some_and(|e| matches!(e.kind(), ErrorKind::PermissionDenied))
}

fn normalize_ext(s: &str) -> String {
    s.trim()
        .trim_start_matches('.')
        .to_ascii_lowercase()
}

pub fn normalize_path_key(path: &Path) -> String {
    path.to_string_lossy()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_ascii_lowercase()
}

fn compute_sha256(path: &Path, max_bytes: u64) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 1024 * 1024];
    let mut read_total: u64 = 0;
    loop {
        let n = file.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        read_total = read_total.saturating_add(n as u64);
        if read_total > max_bytes {
            return Err(format!(
                "File too large to hash (>{} bytes): {}",
                max_bytes,
                path.display()
            ));
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex::encode(hasher.finalize()))
}

#[tauri::command]
async fn scan_files(args: ScanFilesArgs) -> Result<Vec<ScannedFile>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let include_dirs: Vec<PathBuf> = args.include.iter().map(PathBuf::from).collect();
        let exclude_dirs: Vec<PathBuf> = args.exclude.iter().map(PathBuf::from).collect();
        let allowed_exts: std::collections::HashSet<String> =
            args.extensions.iter().map(|e| normalize_ext(e)).collect();

        let mut out: Vec<ScannedFile> = Vec::new();
        let mut seen_paths: std::collections::HashSet<String> = std::collections::HashSet::new();
        for root in include_dirs {
            if !root.exists() {
                continue;
            }
            for entry in WalkDir::new(root)
                .follow_links(false)
                .into_iter()
                .filter_entry(|e| {
                    // Avoid descending into excluded directories (prevents unnecessary IO + permission errors).
                    if e.file_type().is_dir() {
                        let p = e.path();
                        !exclude_dirs.iter().any(|ex| is_under_dir(p, ex))
                    } else {
                        true
                    }
                })
            {
                let entry = match entry {
                    Ok(e) => e,
                    Err(err) => {
                        if !is_walk_permission_denied(&err) {
                            // skip non-permission walk errors
                        }
                        continue;
                    }
                };
                if !entry.file_type().is_file() {
                    continue;
                }
                let path = entry.path();
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
                let meta = match fs::metadata(path) {
                    Ok(m) => m,
                    Err(_err) => continue,
                };
                let modified = meta.modified().ok();
                let mtime_ms = modified
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as i64)
                    .unwrap_or(0);
                let sha256 = compute_sha256(path, 1024 * 1024 * 128)?; // 128MB guardrail
                out.push(ScannedFile {
                    path: path.to_string_lossy().to_string(),
                    size_bytes: meta.len(),
                    mtime_ms,
                    sha256,
                });
            }
        }
        Ok(out)
    })
    .await
    .map_err(|e| format!("scan_files: task join error: {e}"))?
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanFilesCountResult {
    pub total: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanFilesEstimateResult {
    pub total: u64,
    pub image_files: u64,
    pub audio_files: u64,
    pub video_files: u64,
    pub text_like_files: u64,
    pub total_text_bytes: u64,
    pub total_audio_bytes: u64,
    pub total_video_bytes: u64,
}

#[tauri::command]
async fn scan_files_count(args: ScanFilesArgs) -> Result<ScanFilesCountResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let include_dirs: Vec<PathBuf> = args.include.iter().map(PathBuf::from).collect();
        let exclude_dirs: Vec<PathBuf> = args.exclude.iter().map(PathBuf::from).collect();
        let allowed_exts: std::collections::HashSet<String> =
            args.extensions.iter().map(|e| normalize_ext(e)).collect();

        let mut total: u64 = 0;
        let mut seen_paths: std::collections::HashSet<String> = std::collections::HashSet::new();
        for root in include_dirs {
            if !root.exists() {
                continue;
            }
            for entry in WalkDir::new(root)
                .follow_links(false)
                .into_iter()
                .filter_entry(|e| {
                    if e.file_type().is_dir() {
                        let p = e.path();
                        !exclude_dirs.iter().any(|ex| is_under_dir(p, ex))
                    } else {
                        true
                    }
                })
            {
                let entry = match entry {
                    Ok(e) => e,
                    Err(err) => {
                        if !is_walk_permission_denied(&err) {
                            // skip non-permission walk errors
                        }
                        continue;
                    }
                };
                if !entry.file_type().is_file() {
                    continue;
                }
                let path = entry.path();
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
                total = total.saturating_add(1);
            }
        }

        Ok(ScanFilesCountResult { total })
    })
    .await
    .map_err(|e| format!("scan_files_count: task join error: {e}"))?
}

#[tauri::command]
async fn scan_files_estimate(args: ScanFilesArgs) -> Result<ScanFilesEstimateResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let include_dirs: Vec<PathBuf> = args.include.iter().map(PathBuf::from).collect();
        let exclude_dirs: Vec<PathBuf> = args.exclude.iter().map(PathBuf::from).collect();
        let allowed_exts: std::collections::HashSet<String> =
            args.extensions.iter().map(|e| normalize_ext(e)).collect();

        let mut total: u64 = 0;
        let mut seen_paths: std::collections::HashSet<String> = std::collections::HashSet::new();
        let mut image_files: u64 = 0;
        let mut audio_files: u64 = 0;
        let mut video_files: u64 = 0;
        let mut text_like_files: u64 = 0;
        let mut total_text_bytes: u64 = 0;
        let mut total_audio_bytes: u64 = 0;
        let mut total_video_bytes: u64 = 0;

        for root in include_dirs {
            if !root.exists() {
                continue;
            }
            for entry in WalkDir::new(root)
                .follow_links(false)
                .into_iter()
                .filter_entry(|e| {
                    if e.file_type().is_dir() {
                        let p = e.path();
                        !exclude_dirs.iter().any(|ex| is_under_dir(p, ex))
                    } else {
                        true
                    }
                })
            {
                let entry = match entry {
                    Ok(e) => e,
                    Err(err) => {
                        if !is_walk_permission_denied(&err) {
                            // skip non-permission walk errors
                        }
                        continue;
                    }
                };
                if !entry.file_type().is_file() {
                    continue;
                }
                let path = entry.path();
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
                let size_bytes = fs::metadata(path).map(|m| m.len()).unwrap_or(0);
                total = total.saturating_add(1);
                match ext.as_str() {
                    "png" | "jpg" | "jpeg" => {
                        image_files = image_files.saturating_add(1);
                    }
                    "mp3" | "wav" => {
                        audio_files = audio_files.saturating_add(1);
                        total_audio_bytes = total_audio_bytes.saturating_add(size_bytes);
                    }
                    "mp4" | "mov" => {
                        video_files = video_files.saturating_add(1);
                        total_video_bytes = total_video_bytes.saturating_add(size_bytes);
                    }
                    _ => {
                        text_like_files = text_like_files.saturating_add(1);
                        total_text_bytes = total_text_bytes.saturating_add(size_bytes);
                    }
                }
            }
        }

        Ok(ScanFilesEstimateResult {
            total,
            image_files,
            audio_files,
            video_files,
            text_like_files,
            total_text_bytes,
            total_audio_bytes,
            total_video_bytes,
        })
    })
    .await
    .map_err(|e| format!("scan_files_estimate: task join error: {e}"))?
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanFilesNeedsEmbeddingArgs {
    pub scan: ScanFilesArgs,
    pub source_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanFilesNeedsEmbeddingResult {
    pub total_selected: u64,
    pub needs_embedding: bool,
}

#[tauri::command]
async fn scan_files_needs_embedding(
    app: tauri::AppHandle,
    state: tauri::State<'_, qdrant::QdrantState>,
    args: ScanFilesNeedsEmbeddingArgs,
) -> Result<ScanFilesNeedsEmbeddingResult, String> {
    // Scan + hash in a blocking task to avoid freezing the runtime.
    let scanned = scan_files(args.scan).await?;
    let total_selected = scanned.len() as u64;

    // If nothing is selected, nothing needs embedding.
    if scanned.is_empty() {
        return Ok(ScanFilesNeedsEmbeddingResult {
            total_selected,
            needs_embedding: false,
        });
    }

    // Early-exit as soon as we find one file that needs embedding.
    for f in scanned {
        let res = qdrant::upsert_metadata(
            &app,
            &state,
            qdrant::UpsertMetadataArgs {
                source_id: args.source_id.clone(),
                path: f.path,
                content_hash: f.sha256,
            },
        )
        .await?;

        if res.should_embed_content || res.should_embed_metadata {
            return Ok(ScanFilesNeedsEmbeddingResult {
                total_selected,
                needs_embedding: true,
            });
        }
    }

    Ok(ScanFilesNeedsEmbeddingResult {
        total_selected,
        needs_embedding: false,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReadFileArgs {
    pub path: String,
    pub max_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReadFileBase64Result {
    pub base64: String,
    pub size_bytes: u64,
}

#[tauri::command]
fn read_file_base64(args: ReadFileArgs) -> Result<ReadFileBase64Result, String> {
    let path = PathBuf::from(args.path);
    let meta = fs::metadata(&path).map_err(|e| e.to_string())?;
    let size = meta.len();
    if size > args.max_bytes {
        return Err(format!(
            "File too large to read ({} > {} bytes)",
            size, args.max_bytes
        ));
    }
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(ReadFileBase64Result {
        base64: b64,
        size_bytes: size,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThumbnailArgs {
    pub path: String,
    pub max_edge: u32,
    #[serde(default)]
    pub page: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThumbnailResult {
    pub png_base64: String,
}

/// Best-effort thumbnailing for supported files.
#[tauri::command]
async fn thumbnail_image_base64_png(
    app: tauri::AppHandle,
    cache: tauri::State<'_, ThumbnailCache>,
    args: ThumbnailArgs,
) -> Result<ThumbnailResult, String> {
    let path = PathBuf::from(&args.path);
    let meta = fs::metadata(&path).map_err(|e| e.to_string())?;
    let mtime_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let size_bytes = meta.len();
    let max_edge = args.max_edge.clamp(48, 512);
    let page = args.page;
    let cache_key = thumbnail_cache_key(&args.path, max_edge, page);
    let fingerprint = thumbnail_fingerprint(mtime_ms, size_bytes);
    let mut pdfium_candidates: Vec<PathBuf> = Vec::new();
    if let Ok(override_dir) = std::env::var("MANIFOLD_PDFIUM_LIB_DIR") {
        let trimmed = override_dir.trim();
        if !trimmed.is_empty() {
            pdfium_candidates.push(PathBuf::from(trimmed));
        }
    }
    if let Ok(resource_dir) = app.path().resource_dir() {
        pdfium_candidates.push(resource_dir.join("pdfium"));
        pdfium_candidates.push(resource_dir);
    }
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            pdfium_candidates.push(exe_dir.to_path_buf());
            pdfium_candidates.push(exe_dir.join("pdfium"));
            if let Some(src_tauri_dir) = exe_dir.parent().and_then(|p| p.parent()) {
                // Dev mode convenience: allow loading from `src-tauri/resources/pdfium`.
                pdfium_candidates.push(src_tauri_dir.join("resources").join("pdfium"));
                pdfium_candidates.push(src_tauri_dir.join("resources"));
            }
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        pdfium_candidates.push(cwd);
    }

    {
        let guard = cache
            .entries
            .lock()
            .map_err(|_| "thumbnail cache lock poisoned".to_string())?;
        if let Some(entry) = guard.get(&cache_key) {
            if entry.mtime_ms == mtime_ms && entry.size_bytes == size_bytes {
                return Ok(ThumbnailResult {
                    png_base64: entry.png_base64.clone(),
                });
            }
        }
    }

    if let Some(png_base64) = load_disk_thumbnail_base64(&app, &cache_key, &fingerprint)? {
        let mut guard = cache
            .entries
            .lock()
            .map_err(|_| "thumbnail cache lock poisoned".to_string())?;
        if guard.len() >= THUMB_CACHE_MAX_ENTRIES {
            guard.clear();
        }
        guard.insert(
            cache_key.clone(),
            ThumbnailCacheEntry {
                mtime_ms,
                size_bytes,
                png_base64: png_base64.clone(),
            },
        );
        return Ok(ThumbnailResult { png_base64 });
    }

    let path_for_kind = path.clone();
    let render_task = tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        match thumbnail_file_kind(&path_for_kind).as_str() {
            "png" | "jpg" | "jpeg" => render_image_thumbnail_base64(&path, max_edge),
            "pdf" => render_pdf_thumbnail_base64(&path, max_edge, page, &pdfium_candidates),
            ext => Err(format!("thumbnail unsupported file type: {ext}")),
        }
    });
    let png_base64_res = tokio::time::timeout(Duration::from_secs(8), render_task)
        .await
        .map_err(|_| "thumbnail render timed out".to_string())?
        .map_err(|e| format!("thumbnail task join error: {e}"))?;
    let png_base64 = match png_base64_res {
        Ok(value) => value,
        Err(err) => {
            tracing::warn!(
                path = %args.path,
                max_edge = max_edge,
                page = page,
                error = %err,
                "thumbnail generation failed"
            );
            return Err(err);
        }
    };

    {
        let mut guard = cache
            .entries
            .lock()
            .map_err(|_| "thumbnail cache lock poisoned".to_string())?;
        if guard.len() >= THUMB_CACHE_MAX_ENTRIES {
            guard.clear();
        }
        guard.insert(
            cache_key.clone(),
            ThumbnailCacheEntry {
                mtime_ms,
                size_bytes,
                png_base64: png_base64.clone(),
            },
        );
    }
    let _ = store_disk_thumbnail_base64(&app, &cache_key, &fingerprint, &png_base64);

    Ok(ThumbnailResult { png_base64 })
}

#[tauri::command]
async fn qdrant_status(
    app: tauri::AppHandle,
    state: tauri::State<'_, qdrant::QdrantState>,
) -> Result<qdrant::QdrantStatus, String> {
    qdrant::status(&app, &state).await
}

#[tauri::command]
async fn qdrant_upsert_metadata(
    app: tauri::AppHandle,
    state: tauri::State<'_, qdrant::QdrantState>,
    args: qdrant::UpsertMetadataArgs,
) -> Result<qdrant::UpsertMetadataResult, String> {
    qdrant::upsert_metadata(&app, &state, args).await
}

#[tauri::command]
async fn qdrant_upsert_embedding(
    app: tauri::AppHandle,
    state: tauri::State<'_, qdrant::QdrantState>,
    args: qdrant::UpsertEmbeddingArgs,
) -> Result<(), String> {
    qdrant::upsert_embedding(&app, &state, args).await
}

#[tauri::command]
async fn qdrant_semantic_search(
    app: tauri::AppHandle,
    state: tauri::State<'_, qdrant::QdrantState>,
    args: qdrant::SemanticSearchArgs,
) -> Result<Vec<qdrant::SemanticSearchHit>, String> {
    qdrant::semantic_search(&app, &state, args).await
}

#[tauri::command]
async fn qdrant_count_points(
    app: tauri::AppHandle,
    state: tauri::State<'_, qdrant::QdrantState>,
    args: qdrant::CountPointsArgs,
) -> Result<qdrant::CountPointsResult, String> {
    qdrant::count_points(&app, &state, args).await
}

#[tauri::command]
async fn qdrant_delete_all_points(
    app: tauri::AppHandle,
    state: tauri::State<'_, qdrant::QdrantState>,
    text_index_state: tauri::State<'_, text_index::TextIndexState>,
    args: qdrant::DeleteAllPointsArgs,
) -> Result<(), String> {
    qdrant::delete_all_points(&app, &state, args.clone()).await?;
    text_index::delete_all_for_source(&app, &text_index_state, &args.source_id).await?;
    Ok(())
}

#[tauri::command]
async fn qdrant_delete_points_for_paths(
    app: tauri::AppHandle,
    state: tauri::State<'_, qdrant::QdrantState>,
    text_index_state: tauri::State<'_, text_index::TextIndexState>,
    args: qdrant::DeletePointsForPathsArgs,
) -> Result<qdrant::DeletePointsForPathsResult, String> {
    let res = qdrant::delete_points_for_paths(&app, &state, args.clone()).await?;
    text_index::delete_for_paths(&app, &text_index_state, &args.source_id, &args.paths).await?;
    Ok(res)
}


#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HybridSearchArgs {
    source_id: String,
    query_text: String,
    limit: Option<u32>,
    #[serde(default)]
    search_types: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HybridSearchHit {
    score: f32,
    match_type: String,
    file: qdrant::SemanticSearchFile,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TextIndexFullTextArgs {
    source_id: String,
    path: String,
}

#[tauri::command]
async fn hybrid_search(
    app: tauri::AppHandle,
    args: HybridSearchArgs,
) -> Result<Vec<HybridSearchHit>, String> {

    let semantic_limit = args.limit.unwrap_or(24).clamp(1, 256) as usize;
    
    let mut include_text_matches = true;
    let mut include_semantic_matches = true;
    if !args.search_types.is_empty() {
        let selected_types: std::collections::HashSet<String> = args
            .search_types
            .iter()
            .map(|t| t.trim().to_ascii_lowercase())
            .collect();
        include_text_matches = selected_types.contains("text");
        include_semantic_matches = selected_types.contains("semantic");
    }

    // Parallelize text and semantic search
    let text_task = if include_text_matches {
        let app_clone = app.clone();
        let args_clone = args.clone();
        Some(tauri::async_runtime::spawn(async move {
            let text_state = app_clone.state::<text_index::TextIndexState>();
            text_index::search_text(
                &app_clone,
                &text_state,
                text_index::SearchTextArgs {
                    source_id: args_clone.source_id,
                    query: args_clone.query_text,
                    limit: Some(256),
                },
            ).await
        }))
    } else {
        None
    };

    let semantic_task = if include_semantic_matches {
        let app_clone = app.clone();
        let args_clone = args.clone();
        Some(tauri::async_runtime::spawn(async move {
            let qdrant_state = app_clone.state::<qdrant::QdrantState>();
            let query_vector = embedding::embed_query_text(&app_clone, &args_clone.query_text).await?;
            qdrant::semantic_search(
                &app_clone,
                &qdrant_state,
                qdrant::SemanticSearchArgs {
                    source_id: args_clone.source_id,
                    query_vector,
                    limit: Some(semantic_limit as u32),
                    channel: Some(qdrant::SemanticSearchChannel::Content),
                },
            ).await
        }))
    } else {
        None
    };

    let mut out: Vec<HybridSearchHit> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();

    if let Some(task) = text_task {
        let direct = task.await.map_err(|e| format!("text search task failed: {e}"))??;
        for hit in direct {
            if seen.insert(hit.path.clone()) {
                out.push(HybridSearchHit {
                    score: 1.0,
                    match_type: "textMatch".to_string(),
                    file: qdrant::SemanticSearchFile {
                        path: hit.path,
                        content_hash: hit.content_hash,
                    },
                });
            }
        }
    }

    if let Some(task) = semantic_task {
        let content_hits = task.await.map_err(|e| format!("semantic search task failed: {e}"))??;
        let mut semantic_added = 0usize;
        for h in content_hits {
            if seen.insert(h.file.path.clone()) {
                out.push(HybridSearchHit {
                    score: h.score,
                    match_type: "semantic".to_string(),
                    file: h.file,
                });
                semantic_added += 1;
            }
            if semantic_added >= semantic_limit {
                break;
            }
        }
    }

    Ok(out)
}

#[tauri::command]
async fn text_index_full_text_for_path(
    app: tauri::AppHandle,
    text_index_state: tauri::State<'_, text_index::TextIndexState>,
    args: TextIndexFullTextArgs,
) -> Result<Option<String>, String> {
    text_index::get_full_text_for_path(&app, &text_index_state, &args.source_id, &args.path).await
}


#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartEmbeddingJobArgs {
    pub scan: ScanFilesArgs,
    pub source_id: String,
}

#[tauri::command]
async fn start_embedding_job(
    app: tauri::AppHandle,
    embedding_mgr: tauri::State<'_, embedding::EmbeddingManager>,
    qdrant_state: tauri::State<'_, qdrant::QdrantState>,
    args: StartEmbeddingJobArgs,
) -> Result<(), String> {
    embedding::start(app, embedding_mgr, qdrant_state, args.scan, args.source_id).await
}

#[tauri::command]
async fn pause_embedding_job(
    embedding_mgr: tauri::State<'_, embedding::EmbeddingManager>,
) -> Result<(), String> {
    embedding::pause(embedding_mgr).await
}

#[tauri::command]
async fn resume_embedding_job(
    embedding_mgr: tauri::State<'_, embedding::EmbeddingManager>,
) -> Result<(), String> {
    embedding::resume(embedding_mgr).await
}

#[tauri::command]
async fn cancel_embedding_job(
    embedding_mgr: tauri::State<'_, embedding::EmbeddingManager>,
) -> Result<(), String> {
    embedding::cancel(embedding_mgr).await
}

#[tauri::command]
async fn embedding_job_status(
    embedding_mgr: tauri::State<'_, embedding::EmbeddingManager>,
) -> Result<embedding::EmbeddingJobStatus, String> {
    Ok(embedding_mgr.status().await)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EmbedQueryTextArgs {
    text: String,
}

#[tauri::command]
async fn embed_query_text(app: tauri::AppHandle, args: EmbedQueryTextArgs) -> Result<Vec<f32>, String> {
    embedding::embed_query_text(&app, &args.text).await
}

