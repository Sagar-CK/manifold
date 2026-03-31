use base64::Engine;
use pdfium_render::prelude::*;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::Manager;
use walkdir::WalkDir;

mod qdrant;
mod embedding;

const THUMB_CACHE_MAX_ENTRIES: usize = 512;

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

fn thumbnail_cache_key(path: &str, max_edge: u32) -> String {
    format!("{path}::{max_edge}")
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

fn bind_pdfium_library(app: &tauri::AppHandle) -> Result<Box<dyn PdfiumLibraryBindings>, String> {
    let mut errors: Vec<String> = Vec::new();

    if let Ok(raw) = std::env::var("MANIFOLD_PDFIUM_LIB_PATH") {
        let trimmed = raw.trim();
        if !trimmed.is_empty() {
            let candidate = PathBuf::from(trimmed);
            let candidate = if candidate.is_dir() {
                Pdfium::pdfium_platform_library_name_at_path(&candidate)
            } else {
                candidate
            };
            match Pdfium::bind_to_library(&candidate) {
                Ok(bindings) => return Ok(bindings),
                Err(err) => errors.push(format!(
                    "MANIFOLD_PDFIUM_LIB_PATH({}): {}",
                    candidate.display(),
                    err
                )),
            }
        }
    }

    let mut candidates: Vec<PathBuf> = vec![
        Pdfium::pdfium_platform_library_name_at_path("./"),
        PathBuf::from("/opt/homebrew/lib").join(Pdfium::pdfium_platform_library_name()),
        PathBuf::from("/usr/local/lib").join(Pdfium::pdfium_platform_library_name()),
    ];

    // Prefer loading from app-managed paths so packaged builds work out-of-the-box.
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join(Pdfium::pdfium_platform_library_name()));
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            candidates.push(parent.join(Pdfium::pdfium_platform_library_name()));
            candidates.push(parent.join("../Frameworks").join(Pdfium::pdfium_platform_library_name()));
            candidates.push(parent.join("../Resources").join(Pdfium::pdfium_platform_library_name()));
        }
    }

    for candidate in candidates {
        match Pdfium::bind_to_library(&candidate) {
            Ok(bindings) => return Ok(bindings),
            Err(err) => errors.push(format!("{}: {}", candidate.display(), err)),
        }
    }

    Pdfium::bind_to_system_library().map_err(|err| {
        errors.push(format!("system: {err}"));
        format!(
            "failed to load Pdfium. Set MANIFOLD_PDFIUM_LIB_PATH to a pdfium library path or \
             install libpdfium.dylib (Homebrew path: /opt/homebrew/lib/libpdfium.dylib). Attempts: {}",
            errors.join(" | ")
        )
    })
}

fn render_pdf_thumbnail_base64(
    app: &tauri::AppHandle,
    path: &Path,
    max_edge: u32,
) -> Result<String, String> {
    let bindings = bind_pdfium_library(app)?;
    let pdfium = Pdfium::new(bindings);
    let document = pdfium
        .load_pdf_from_file(path, None)
        .map_err(|e| e.to_string())?;
    let page = document.pages().get(0).map_err(|e| e.to_string())?;
    let target = std::cmp::max(1, max_edge) as i32;
    let rendered = page
        .render_with_config(
            &PdfRenderConfig::new()
                .set_target_width(target)
                .set_maximum_height(target),
        )
        .map_err(|e| e.to_string())?;
    let thumb_img = rendered.as_image();
    let mut out = Vec::new();
    thumb_img
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
    // MANIFOLD_LOG is preferred; RUST_LOG is also supported.
    // Examples:
    // - MANIFOLD_LOG=info
    // - MANIFOLD_LOG=debug,reqwest=warn
    // - MANIFOLD_LOG=manifold_lib=trace
    let filter = std::env::var("MANIFOLD_LOG")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .or_else(|| std::env::var("RUST_LOG").ok())
        .unwrap_or_else(|| "info".to_string());

    let env_filter = tracing_subscriber::EnvFilter::try_new(filter)
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"));

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
    tracing::info!("starting tauri backend");
    tauri::Builder::default()
        .manage(qdrant::QdrantState::default())
        .manage(embedding::EmbeddingManager::default())
        .manage(ThumbnailCache::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
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
            qdrant_count_points,
            qdrant_delete_all_points,
            qdrant_delete_points_for_paths,
            start_embedding_job,
            pause_embedding_job,
            resume_embedding_job,
            cancel_embedding_job,
            embedding_job_status,
            embed_query_text
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
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
    tracing::info!(
        include_count = args.include.len(),
        exclude_count = args.exclude.len(),
        extensions_count = args.extensions.len(),
        "scan_files: start"
    );
    tauri::async_runtime::spawn_blocking(move || {
        let include_dirs: Vec<PathBuf> = args.include.iter().map(PathBuf::from).collect();
        let exclude_dirs: Vec<PathBuf> = args.exclude.iter().map(PathBuf::from).collect();
        let allowed_exts: std::collections::HashSet<String> =
            args.extensions.iter().map(|e| normalize_ext(e)).collect();

        let mut out: Vec<ScannedFile> = Vec::new();
        for root in include_dirs {
            if !root.exists() {
                tracing::warn!(root = %root.display(), "scan_files: include root does not exist");
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
                            tracing::debug!(error = %err, "scan_files: walkdir error");
                        }
                        continue;
                    }
                };
                if !entry.file_type().is_file() {
                    continue;
                }
                let path = entry.path();
                let ext = path
                    .extension()
                    .and_then(|s| s.to_str())
                    .map(normalize_ext);
                let Some(ext) = ext else { continue };
                if !allowed_exts.contains(&ext) {
                    continue;
                }
                let meta = match fs::metadata(path) {
                    Ok(m) => m,
                    Err(err) => {
                        tracing::debug!(
                            path = %path.display(),
                            error = %err,
                            "scan_files: metadata error"
                        );
                        continue;
                    }
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
        tracing::info!(count = out.len(), "scan_files: done");
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
    tracing::info!(
        include_count = args.include.len(),
        exclude_count = args.exclude.len(),
        extensions_count = args.extensions.len(),
        "scan_files_count: start"
    );
    tauri::async_runtime::spawn_blocking(move || {
        let include_dirs: Vec<PathBuf> = args.include.iter().map(PathBuf::from).collect();
        let exclude_dirs: Vec<PathBuf> = args.exclude.iter().map(PathBuf::from).collect();
        let allowed_exts: std::collections::HashSet<String> =
            args.extensions.iter().map(|e| normalize_ext(e)).collect();

        let mut total: u64 = 0;
        for root in include_dirs {
            if !root.exists() {
                tracing::warn!(
                    root = %root.display(),
                    "scan_files_count: include root does not exist"
                );
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
                            tracing::debug!(error = %err, "scan_files_count: walkdir error");
                        }
                        continue;
                    }
                };
                if !entry.file_type().is_file() {
                    continue;
                }
                let path = entry.path();
                let ext = path
                    .extension()
                    .and_then(|s| s.to_str())
                    .map(normalize_ext);
                let Some(ext) = ext else { continue };
                if !allowed_exts.contains(&ext) {
                    continue;
                }
                total = total.saturating_add(1);
            }
        }

        tracing::info!(total, "scan_files_count: done");
        Ok(ScanFilesCountResult { total })
    })
    .await
    .map_err(|e| format!("scan_files_count: task join error: {e}"))?
}

#[tauri::command]
async fn scan_files_estimate(args: ScanFilesArgs) -> Result<ScanFilesEstimateResult, String> {
    tracing::info!(
        include_count = args.include.len(),
        exclude_count = args.exclude.len(),
        extensions_count = args.extensions.len(),
        "scan_files_estimate: start"
    );
    tauri::async_runtime::spawn_blocking(move || {
        let include_dirs: Vec<PathBuf> = args.include.iter().map(PathBuf::from).collect();
        let exclude_dirs: Vec<PathBuf> = args.exclude.iter().map(PathBuf::from).collect();
        let allowed_exts: std::collections::HashSet<String> =
            args.extensions.iter().map(|e| normalize_ext(e)).collect();

        let mut total: u64 = 0;
        let mut image_files: u64 = 0;
        let mut audio_files: u64 = 0;
        let mut video_files: u64 = 0;
        let mut text_like_files: u64 = 0;
        let mut total_text_bytes: u64 = 0;
        let mut total_audio_bytes: u64 = 0;
        let mut total_video_bytes: u64 = 0;

        for root in include_dirs {
            if !root.exists() {
                tracing::warn!(
                    root = %root.display(),
                    "scan_files_estimate: include root does not exist"
                );
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
                            tracing::debug!(error = %err, "scan_files_estimate: walkdir error");
                        }
                        continue;
                    }
                };
                if !entry.file_type().is_file() {
                    continue;
                }
                let path = entry.path();
                let ext = path
                    .extension()
                    .and_then(|s| s.to_str())
                    .map(normalize_ext);
                let Some(ext) = ext else { continue };
                if !allowed_exts.contains(&ext) {
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

        tracing::info!(
            total,
            image_files,
            audio_files,
            video_files,
            text_like_files,
            total_text_bytes,
            total_audio_bytes,
            total_video_bytes,
            "scan_files_estimate: done"
        );
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
    tracing::info!(
        include_count = args.scan.include.len(),
        exclude_count = args.scan.exclude.len(),
        extensions_count = args.scan.extensions.len(),
        "scan_files_needs_embedding: start"
    );

    // Scan + hash in a blocking task to avoid freezing the runtime.
    let scanned = scan_files(args.scan).await?;
    let total_selected = scanned.len() as u64;

    // If nothing is selected, nothing needs embedding.
    if scanned.is_empty() {
        tracing::info!("scan_files_needs_embedding: no selected files");
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

        if res.should_embed {
            tracing::info!(
                total_selected,
                "scan_files_needs_embedding: needs embedding (early exit)"
            );
            return Ok(ScanFilesNeedsEmbeddingResult {
                total_selected,
                needs_embedding: true,
            });
        }
    }

    tracing::info!(total_selected, "scan_files_needs_embedding: all up to date");
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
    tracing::debug!(path = %args.path, max_bytes = args.max_bytes, "read_file_base64: start");
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
    tracing::debug!(size_bytes = size, "read_file_base64: done");
    Ok(ReadFileBase64Result {
        base64: b64,
        size_bytes: size,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThumbnailArgs {
    pub path: String,
    pub max_edge: u32,
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
    let started = std::time::Instant::now();
    tracing::debug!(path = %args.path, max_edge = args.max_edge, "thumbnail_image_base64_png: start");

    let path = PathBuf::from(&args.path);
    let meta = fs::metadata(&path).map_err(|e| e.to_string())?;
    let mtime_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let size_bytes = meta.len();
    let cache_key = thumbnail_cache_key(&args.path, args.max_edge);

    {
        let guard = cache
            .entries
            .lock()
            .map_err(|_| "thumbnail cache lock poisoned".to_string())?;
        if let Some(entry) = guard.get(&cache_key) {
            if entry.mtime_ms == mtime_ms && entry.size_bytes == size_bytes {
                tracing::debug!(
                    elapsed_ms = started.elapsed().as_millis(),
                    "thumbnail_image_base64_png: cache hit"
                );
                return Ok(ThumbnailResult {
                    png_base64: entry.png_base64.clone(),
                });
            }
        }
    }

    let max_edge = args.max_edge;
    let path_for_kind = path.clone();
    let app_for_worker = app.clone();
    let kind = thumbnail_file_kind(&path);
    let png_base64_res = tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        match thumbnail_file_kind(&path_for_kind).as_str() {
            "png" | "jpg" | "jpeg" => render_image_thumbnail_base64(&path, max_edge),
            "pdf" => render_pdf_thumbnail_base64(&app_for_worker, &path, max_edge),
            ext => Err(format!("thumbnail unsupported file type: {ext}")),
        }
    })
    .await
    .map_err(|e| format!("thumbnail task join error: {e}"))?;
    let png_base64 = match png_base64_res {
        Ok(v) => v,
        Err(err) => {
            if kind == "pdf" {
                tracing::warn!(
                    path = %args.path,
                    error = %err,
                    "thumbnail_image_base64_png: pdf thumbnail failed"
                );
            } else {
                tracing::debug!(
                    path = %args.path,
                    file_kind = %kind,
                    error = %err,
                    "thumbnail_image_base64_png: thumbnail generation failed"
                );
            }
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
            cache_key,
            ThumbnailCacheEntry {
                mtime_ms,
                size_bytes,
                png_base64: png_base64.clone(),
            },
        );
    }

    tracing::debug!(elapsed_ms = started.elapsed().as_millis(), "thumbnail_image_base64_png: done");
    Ok(ThumbnailResult { png_base64 })
}

#[tauri::command]
async fn qdrant_status(
    app: tauri::AppHandle,
    state: tauri::State<'_, qdrant::QdrantState>,
) -> Result<qdrant::QdrantStatus, String> {
    tracing::debug!("qdrant_status: start");
    qdrant::status(&app, &state).await
}

#[tauri::command]
async fn qdrant_upsert_metadata(
    app: tauri::AppHandle,
    state: tauri::State<'_, qdrant::QdrantState>,
    args: qdrant::UpsertMetadataArgs,
) -> Result<qdrant::UpsertMetadataResult, String> {
    tracing::info!(
        source_id = %args.source_id,
        path = %args.path,
        content_hash_prefix = %args.content_hash.chars().take(12).collect::<String>(),
        "qdrant_upsert_metadata: start"
    );
    qdrant::upsert_metadata(&app, &state, args).await
}

#[tauri::command]
async fn qdrant_upsert_embedding(
    app: tauri::AppHandle,
    state: tauri::State<'_, qdrant::QdrantState>,
    args: qdrant::UpsertEmbeddingArgs,
) -> Result<(), String> {
    tracing::info!(
        source_id = %args.source_id,
        path = %args.path,
        embedding_len = args.embedding.len(),
        content_hash_prefix = %args.content_hash.chars().take(12).collect::<String>(),
        "qdrant_upsert_embedding: start"
    );
    qdrant::upsert_embedding(&app, &state, args).await
}

#[tauri::command]
async fn qdrant_semantic_search(
    app: tauri::AppHandle,
    state: tauri::State<'_, qdrant::QdrantState>,
    args: qdrant::SemanticSearchArgs,
) -> Result<Vec<qdrant::SemanticSearchHit>, String> {
    tracing::info!(
        source_id = %args.source_id,
        query_vector_len = args.query_vector.len(),
        limit = args.limit.unwrap_or(16),
        "qdrant_semantic_search: start"
    );
    qdrant::semantic_search(&app, &state, args).await
}

#[tauri::command]
async fn qdrant_count_points(
    app: tauri::AppHandle,
    state: tauri::State<'_, qdrant::QdrantState>,
    args: qdrant::CountPointsArgs,
) -> Result<qdrant::CountPointsResult, String> {
    tracing::debug!(source_id = %args.source_id, "qdrant_count_points: start");
    qdrant::count_points(&app, &state, args).await
}

#[tauri::command]
async fn qdrant_delete_all_points(
    app: tauri::AppHandle,
    state: tauri::State<'_, qdrant::QdrantState>,
    args: qdrant::DeleteAllPointsArgs,
) -> Result<(), String> {
    tracing::info!(source_id = %args.source_id, "qdrant_delete_all_points: start");
    qdrant::delete_all_points(&app, &state, args).await
}

#[tauri::command]
async fn qdrant_delete_points_for_paths(
    app: tauri::AppHandle,
    state: tauri::State<'_, qdrant::QdrantState>,
    args: qdrant::DeletePointsForPathsArgs,
) -> Result<qdrant::DeletePointsForPathsResult, String> {
    tracing::info!(
        source_id = %args.source_id,
        path_count = args.paths.len(),
        "qdrant_delete_points_for_paths: start"
    );
    qdrant::delete_points_for_paths(&app, &state, args).await
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
async fn embed_query_text(args: EmbedQueryTextArgs) -> Result<Vec<f32>, String> {
    let started = std::time::Instant::now();
    let text_len = args.text.chars().count();
    let res = embedding::embed_query_text(&args.text).await;
    match &res {
        Ok(v) => tracing::info!(
            text_len,
            embedding_len = v.len(),
            elapsed_ms = started.elapsed().as_millis(),
            "embed_query_text: done"
        ),
        Err(err) => tracing::warn!(
            text_len,
            elapsed_ms = started.elapsed().as_millis(),
            error = %err,
            "embed_query_text: failed"
        ),
    }
    res
}
