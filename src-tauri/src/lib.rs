use base64::Engine;
use pdfium_render::prelude::*;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu, HELP_SUBMENU_ID},
    Emitter, Manager,
};

mod gemini_settings;
mod logging;
mod qdrant;
mod embedding;
mod scan;
mod text_index;

pub use scan::{
    any_candidate_needs_embedding, compute_sha256, is_path_excluded, is_under_dir, normalize_ext,
    normalize_path_key, scan_files, scan_files_count, scan_files_estimate,
    scan_files_needs_embedding, ScanFilesArgs, ScanFilesEstimateResult,
    ScanFilesNeedsEmbeddingArgs, ScanWalkCandidate, ScannedFile, MAX_EMBED_FILE_BYTES,
    walk_scan_candidates,
};

const THUMB_CACHE_MAX_ENTRIES: usize = 512;
const THUMB_CACHE_SCHEMA_VERSION: &str = "v3";
const APP_SHORTCUT_EVENT: &str = "app://shortcut";
const MENU_NAVIGATE_SEARCH_ID: &str = "navigate-search";
const MENU_NAVIGATE_GRAPH_ID: &str = "navigate-graph";
const MENU_NAVIGATE_REVIEW_TAGS_ID: &str = "navigate-review-tags";
const MENU_OPEN_SETTINGS_ID: &str = "navigate-settings";
const MENU_SHOW_KEYBOARD_SHORTCUTS_ID: &str = "show-keyboard-shortcuts";

#[derive(Debug, Clone, Serialize)]
struct AppShortcutEventPayload {
    action: &'static str,
}

fn emit_app_shortcut<R: tauri::Runtime>(app: &tauri::AppHandle<R>, action: &'static str) {
    let _ = app.emit(APP_SHORTCUT_EVENT, AppShortcutEventPayload { action });
}

fn build_app_menu<R: tauri::Runtime>(app_handle: &tauri::AppHandle<R>) -> tauri::Result<Menu<R>> {
    let menu = Menu::default(app_handle)?;

    let search_item = MenuItem::with_id(
        app_handle,
        MENU_NAVIGATE_SEARCH_ID,
        "Search",
        true,
        Some("CmdOrCtrl+K"),
    )?;
    let graph_item = MenuItem::with_id(
        app_handle,
        MENU_NAVIGATE_GRAPH_ID,
        "Graph Explorer",
        true,
        Some("CmdOrCtrl+G"),
    )?;
    let review_tags_item = MenuItem::with_id(
        app_handle,
        MENU_NAVIGATE_REVIEW_TAGS_ID,
        "Review Suggested Tags",
        true,
        Some("CmdOrCtrl+Shift+T"),
    )?;
    let settings_item = MenuItem::with_id(
        app_handle,
        MENU_OPEN_SETTINGS_ID,
        "Settings",
        true,
        Some("CmdOrCtrl+,"),
    )?;
    let navigate_separator = PredefinedMenuItem::separator(app_handle)?;
    let navigate_menu = Submenu::with_items(
        app_handle,
        "Navigate",
        true,
        &[
            &search_item,
            &graph_item,
            &review_tags_item,
            &navigate_separator,
            &settings_item,
        ],
    )?;

    let items = menu.items()?;
    let help_index = items
        .iter()
        .position(|item| item.id() == HELP_SUBMENU_ID)
        .unwrap_or(items.len());
    menu.insert(&navigate_menu, help_index)?;

    let help_menu = if let Some(existing) = menu
        .get(HELP_SUBMENU_ID)
        .and_then(|item| item.as_submenu().cloned())
    {
        existing
    } else {
        let submenu = Submenu::with_id(app_handle, HELP_SUBMENU_ID, "Help", true)?;
        menu.append(&submenu)?;
        submenu
    };

    if !help_menu.items()?.is_empty() {
        let separator = PredefinedMenuItem::separator(app_handle)?;
        help_menu.append(&separator)?;
    }

    let keyboard_shortcuts_item = MenuItem::with_id(
        app_handle,
        MENU_SHOW_KEYBOARD_SHORTCUTS_ID,
        "Keyboard Shortcuts",
        true,
        Some("CmdOrCtrl+/"),
    )?;
    help_menu.append(&keyboard_shortcuts_item)?;

    Ok(menu)
}

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

fn ffmpeg_tool_file_name(tool: &str) -> String {
    if cfg!(target_os = "windows") {
        format!("{tool}.exe")
    } else {
        tool.to_string()
    }
}

#[derive(Debug, Clone)]
struct FfmpegToolLookup {
    override_dir: Option<PathBuf>,
    resource_dir: Option<PathBuf>,
    exe_path: Option<PathBuf>,
    cwd: Option<PathBuf>,
    path_dirs: Vec<PathBuf>,
}

fn ffmpeg_tool_candidates(tool: &str, lookup: &FfmpegToolLookup) -> Vec<PathBuf> {
    let file_name = ffmpeg_tool_file_name(tool);
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Some(dir) = &lookup.override_dir {
        candidates.push(dir.join(&file_name));
    }

    if let Some(resource_dir) = &lookup.resource_dir {
        candidates.push(resource_dir.join("ffmpeg").join(&file_name));
        candidates.push(resource_dir.join("resources").join("ffmpeg").join(&file_name));
        candidates.push(resource_dir.join(&file_name));
    }

    if let Some(exe_path) = &lookup.exe_path {
        if let Some(exe_dir) = exe_path.parent() {
            candidates.push(exe_dir.join("ffmpeg").join(&file_name));
            candidates.push(exe_dir.join(&file_name));
            if exe_path
                .components()
                .any(|c| c.as_os_str() == std::ffi::OsStr::new("target"))
            {
                candidates.push(exe_dir.join("../../resources/ffmpeg").join(&file_name));
            }
            if let Some(src_tauri_dir) = exe_dir.parent().and_then(|p| p.parent()) {
                candidates.push(src_tauri_dir.join("resources").join("ffmpeg").join(&file_name));
            }
        }
    }

    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("ffmpeg")
            .join(&file_name),
    );

    if let Some(cwd) = &lookup.cwd {
        candidates.push(cwd.join("src-tauri").join("resources").join("ffmpeg").join(&file_name));
    }

    for dir in &lookup.path_dirs {
        candidates.push(dir.join(&file_name));
    }

    candidates
}

fn resolve_first_existing_path(candidates: &[PathBuf]) -> Option<PathBuf> {
    candidates.iter().find(|path| path.exists()).cloned()
}

fn resolve_ffmpeg_tool_path(app: &tauri::AppHandle, tool: &str) -> Result<PathBuf, String> {
    let override_dir = std::env::var_os("MANIFOLD_FFMPEG_BIN_DIR")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from);
    let path_dirs = std::env::var_os("PATH")
        .map(|raw| std::env::split_paths(&raw).collect::<Vec<PathBuf>>())
        .unwrap_or_default();
    let lookup = FfmpegToolLookup {
        override_dir,
        resource_dir: app.path().resource_dir().ok(),
        exe_path: std::env::current_exe().ok(),
        cwd: std::env::current_dir().ok(),
        path_dirs,
    };
    let candidates = ffmpeg_tool_candidates(tool, &lookup);
    resolve_first_existing_path(&candidates).ok_or_else(|| {
        format!(
            "{tool} binary was not found. Run `pnpm setup:dev` (or `pnpm setup:binaries`) to install FFmpeg under src-tauri/resources/ffmpeg/, or set MANIFOLD_FFMPEG_BIN_DIR."
        )
    })
}

fn parse_ffprobe_duration(output: &[u8]) -> Option<f64> {
    let raw = String::from_utf8_lossy(output);
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let seconds = trimmed.parse::<f64>().ok()?;
    if seconds.is_finite() && seconds >= 0.0 {
        Some(seconds)
    } else {
        None
    }
}

fn choose_video_thumbnail_seek_seconds(duration_secs: Option<f64>) -> f64 {
    match duration_secs {
        Some(duration) if duration.is_finite() && duration > 0.0 => (duration * 0.10).clamp(1.0, 30.0),
        _ => 1.0,
    }
}

fn probe_video_duration_seconds(ffprobe_path: &Path, video_path: &Path) -> Option<f64> {
    let output = Command::new(ffprobe_path)
        .arg("-v")
        .arg("error")
        .arg("-show_entries")
        .arg("format=duration")
        .arg("-of")
        .arg("default=noprint_wrappers=1:nokey=1")
        .arg(video_path)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    parse_ffprobe_duration(&output.stdout)
}

fn ffmpeg_stderr_text(output: &std::process::Output) -> String {
    let text = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if text.is_empty() {
        "ffmpeg did not produce a thumbnail frame".to_string()
    } else {
        text
    }
}

fn render_video_thumbnail_at_seek_base64(
    ffmpeg_path: &Path,
    video_path: &Path,
    max_edge: u32,
    seek_seconds: f64,
) -> Result<String, String> {
    let seek = format!("{seek_seconds:.3}");
    let scale = format!("scale={max_edge}:{max_edge}:force_original_aspect_ratio=decrease");
    let output = Command::new(ffmpeg_path)
        .arg("-v")
        .arg("error")
        .arg("-ss")
        .arg(&seek)
        .arg("-i")
        .arg(video_path)
        .arg("-frames:v")
        .arg("1")
        .arg("-an")
        .arg("-sn")
        .arg("-dn")
        .arg("-vf")
        .arg(&scale)
        .arg("-f")
        .arg("image2pipe")
        .arg("-vcodec")
        .arg("png")
        .arg("pipe:1")
        .output()
        .map_err(|e| format!("ffmpeg spawn failed: {e}"))?;
    if !output.status.success() || output.stdout.is_empty() {
        return Err(ffmpeg_stderr_text(&output));
    }
    Ok(base64::engine::general_purpose::STANDARD.encode(output.stdout))
}

fn render_video_thumbnail_base64(
    path: &Path,
    max_edge: u32,
    ffmpeg_path: &Path,
    ffprobe_path: &Path,
) -> Result<String, String> {
    let duration_secs = probe_video_duration_seconds(ffprobe_path, path);
    let first_seek = choose_video_thumbnail_seek_seconds(duration_secs);
    match render_video_thumbnail_at_seek_base64(ffmpeg_path, path, max_edge, first_seek) {
        Ok(base64_png) => Ok(base64_png),
        Err(err) if first_seek > 0.0 => {
            render_video_thumbnail_at_seek_base64(ffmpeg_path, path, max_edge, 0.0)
                .map_err(|retry_err| format!("{err}; retry at 0s failed: {retry_err}"))
        }
        Err(err) => Err(err),
    }
}

fn thumbnail_supported_file_kind(kind: &str) -> bool {
    matches!(kind, "png" | "jpg" | "jpeg" | "pdf" | "mp4" | "mov")
}

/// Search paths for the PDFium dynamic library (shared with thumbnails and embedding).
pub(crate) fn pdfium_library_candidates(app: &tauri::AppHandle) -> Vec<PathBuf> {
    let mut pdfium_candidates: Vec<PathBuf> = Vec::new();
    if let Ok(override_dir) = std::env::var("MANIFOLD_PDFIUM_LIB_DIR") {
        let trimmed = override_dir.trim();
        if !trimmed.is_empty() {
            let base = PathBuf::from(trimmed);
            pdfium_candidates.push(base.clone());
            pdfium_candidates.push(base.join("resources").join("pdfium"));
        }
    }
    pdfium_candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("pdfium"),
    );
    if let Ok(resource_dir) = app.path().resource_dir() {
        pdfium_candidates.push(resource_dir.join("pdfium"));
        pdfium_candidates.push(resource_dir.join("resources").join("pdfium"));
    }
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            if exe_path
                .components()
                .any(|c| c.as_os_str() == std::ffi::OsStr::new("target"))
            {
                pdfium_candidates.push(exe_dir.join("../../resources/pdfium"));
            }
            pdfium_candidates.push(exe_dir.to_path_buf());
            pdfium_candidates.push(exe_dir.join("pdfium"));
            if let Some(src_tauri_dir) = exe_dir.parent().and_then(|p| p.parent()) {
                pdfium_candidates.push(src_tauri_dir.join("resources").join("pdfium"));
            }
        }
    }
    pdfium_candidates
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
        match Pdfium::bind_to_library(&lib_path) {
            Ok(bindings) => return Ok(Pdfium::new(bindings)),
            Err(err) => {
                let exists = lib_path.exists();
                attempted.push(format!(
                    "{} (file exists: {exists}, error: {err})",
                    lib_path.display()
                ));
            }
        }
    }
    let bindings = Pdfium::bind_to_system_library().map_err(|e| {
        let attempted_list = if attempted.is_empty() {
            "none".to_string()
        } else {
            attempted.join("; ")
        };
        format!(
            "pdf thumbnail renderer unavailable: could not load PDFium. Tried: [{attempted_list}]. Then system library failed ({e}). Install PDFium under src-tauri/resources/pdfium/ (see pnpm setup:dev) or set MANIFOLD_PDFIUM_LIB_DIR."
        )
    })?;
    Ok(Pdfium::new(bindings))
}

const PDFIUM_EXTRACT_MAX_CHARS: usize = 512 * 1024;

/// Extract text from a PDF using PDFium (digitally born text only; scanned pages stay empty).
pub(crate) fn extract_pdf_text_pdfium(path: &Path, candidates: &[PathBuf]) -> Result<String, String> {
    let pdfium = load_pdfium(candidates)?;
    let document = pdfium.load_pdf_from_file(path, None).map_err(|e| e.to_string())?;
    let mut out = String::new();
    for page in document.pages().iter() {
        if out.len() >= PDFIUM_EXTRACT_MAX_CHARS {
            break;
        }
        let page_text = page.text().map_err(|e| e.to_string())?;
        let page_str = page_text.to_string();
        if page_str.trim().is_empty() {
            continue;
        }
        if !out.is_empty() {
            out.push('\n');
        }
        let remaining = PDFIUM_EXTRACT_MAX_CHARS.saturating_sub(out.len());
        if page_str.len() <= remaining {
            out.push_str(&page_str);
        } else {
            let tail: String = page_str.chars().take(remaining).collect();
            out.push_str(&tail);
            break;
        }
    }
    Ok(out)
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
    let repo_env_path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("src-tauri has a workspace root")
        .join(".env.local");
    let _ = dotenvy::from_path(&repo_env_path);
}

fn load_app_data_env(app: &tauri::AppHandle) {
    if let Ok(dir) = app.path().app_data_dir() {
        let _ = dotenvy::from_path(dir.join(".env.local"));
    }
}

fn init_logging() {
    logging::init();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    load_env();
    init_logging();
    let app = tauri::Builder::default()
        .menu(build_app_menu)
        .on_menu_event(|app, event| {
            if event.id() == MENU_NAVIGATE_SEARCH_ID {
                emit_app_shortcut(app, "search");
            } else if event.id() == MENU_NAVIGATE_GRAPH_ID {
                emit_app_shortcut(app, "graph");
            } else if event.id() == MENU_NAVIGATE_REVIEW_TAGS_ID {
                emit_app_shortcut(app, "review-tags");
            } else if event.id() == MENU_OPEN_SETTINGS_ID {
                emit_app_shortcut(app, "settings");
            } else if event.id() == MENU_SHOW_KEYBOARD_SHORTCUTS_ID {
                emit_app_shortcut(app, "show-shortcuts");
            }
        })
        .manage(qdrant::QdrantState::default())
        .manage(embedding::EmbeddingManager::default())
        .manage(text_index::TextIndexState::default())
        .manage(ThumbnailCache::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            load_app_data_env(app.handle());
            gemini_settings::init_storage(app.handle());
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
            qdrant_similar_by_path,
            hybrid_search,
            qdrant_count_points,
            qdrant_scroll_graph,
            qdrant_set_path_tag_ids,
            qdrant_delete_all_points,
            qdrant_delete_points_for_paths,
            prune_missing_indexed_paths,
            qdrant_delete_points_for_include_path,
            start_embedding_job,
            pause_embedding_job,
            resume_embedding_job,
            cancel_embedding_job,
            embedding_job_status,
            embed_query_text,
            text_index_full_text_for_path,
            gemini_judge_tag,
            gemini_api_key_status,
            save_gemini_api_key,
            clear_stored_gemini_api_key
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

/// Max edge (px) and JPEG quality for raster images sent to Gemini (embed + OCR).
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VisionRasterOptions {
    pub max_edge_px: u32,
    pub jpeg_quality: u8,
}

impl Default for VisionRasterOptions {
    fn default() -> Self {
        Self {
            max_edge_px: 1536,
            jpeg_quality: 85,
        }
    }
}

pub fn clamp_vision_raster_options(o: VisionRasterOptions) -> VisionRasterOptions {
    VisionRasterOptions {
        max_edge_px: o.max_edge_px.clamp(256, 2048),
        jpeg_quality: o.jpeg_quality.clamp(50, 95),
    }
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
    let pdfium_candidates = pdfium_library_candidates(&app);

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
    let thumb_kind = thumbnail_file_kind(&path_for_kind);
    if !thumbnail_supported_file_kind(&thumb_kind) {
        return Err(format!("thumbnail unsupported file type: {thumb_kind}"));
    }
    let ffmpeg_path = if matches!(thumb_kind.as_str(), "mp4" | "mov") {
        Some(resolve_ffmpeg_tool_path(&app, "ffmpeg")?)
    } else {
        None
    };
    let ffprobe_path = if matches!(thumb_kind.as_str(), "mp4" | "mov") {
        Some(resolve_ffmpeg_tool_path(&app, "ffprobe")?)
    } else {
        None
    };
    let render_task = tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        match thumb_kind.as_str() {
            "png" | "jpg" | "jpeg" => render_image_thumbnail_base64(&path, max_edge),
            "pdf" => render_pdf_thumbnail_base64(&path, max_edge, page, &pdfium_candidates),
            "mp4" | "mov" => render_video_thumbnail_base64(
                &path,
                max_edge,
                ffmpeg_path
                    .as_deref()
                    .ok_or_else(|| "ffmpeg path missing".to_string())?,
                ffprobe_path
                    .as_deref()
                    .ok_or_else(|| "ffprobe path missing".to_string())?,
            ),
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
                target: crate::logging::TARGET_THUMBNAIL,
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
async fn qdrant_similar_by_path(
    app: tauri::AppHandle,
    state: tauri::State<'_, qdrant::QdrantState>,
    args: qdrant::SimilarByPathArgs,
) -> Result<Vec<qdrant::SemanticSearchHit>, String> {
    qdrant::similar_by_path(&app, &state, args).await
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
async fn qdrant_scroll_graph(
    app: tauri::AppHandle,
    state: tauri::State<'_, qdrant::QdrantState>,
    text_index_state: tauri::State<'_, text_index::TextIndexState>,
    args: qdrant::ScrollGraphArgs,
) -> Result<qdrant::ScrollGraphResult, String> {
    let source_id = args.source_id.clone();
    let (result, stale_paths) = qdrant::scroll_graph(&app, &state, args).await?;
    if !stale_paths.is_empty() {
        qdrant::delete_points_for_paths(
            &app,
            &state,
            qdrant::DeletePointsForPathsArgs {
                source_id: source_id.clone(),
                paths: stale_paths.clone(),
            },
        )
        .await?;
        text_index::delete_for_paths(&app, &text_index_state, &source_id, &stale_paths).await?;
    }
    Ok(result)
}

#[tauri::command]
async fn qdrant_set_path_tag_ids(
    app: tauri::AppHandle,
    state: tauri::State<'_, qdrant::QdrantState>,
    args: qdrant::SetPathTagIdsArgs,
) -> Result<(), String> {
    qdrant::set_path_tag_ids(&app, &state, args).await
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

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct PruneMissingPathsArgs {
    source_id: String,
    paths: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PruneMissingPathsResult {
    removed_paths: Vec<String>,
}

#[tauri::command]
async fn prune_missing_indexed_paths(
    app: tauri::AppHandle,
    state: tauri::State<'_, qdrant::QdrantState>,
    text_index_state: tauri::State<'_, text_index::TextIndexState>,
    args: PruneMissingPathsArgs,
) -> Result<PruneMissingPathsResult, String> {
    use std::collections::HashSet;
    use std::path::Path;

    let mut seen = HashSet::new();
    let removed_paths: Vec<String> = args
        .paths
        .into_iter()
        .filter(|path| seen.insert(path.clone()))
        .filter(|path| !Path::new(path).exists())
        .collect();

    if removed_paths.is_empty() {
        return Ok(PruneMissingPathsResult { removed_paths });
    }

    qdrant::delete_points_for_paths(
        &app,
        &state,
        qdrant::DeletePointsForPathsArgs {
            source_id: args.source_id.clone(),
            paths: removed_paths.clone(),
        },
    )
    .await?;
    text_index::delete_for_paths(&app, &text_index_state, &args.source_id, &removed_paths).await?;

    Ok(PruneMissingPathsResult { removed_paths })
}

#[tauri::command]
async fn qdrant_delete_points_for_include_path(
    app: tauri::AppHandle,
    state: tauri::State<'_, qdrant::QdrantState>,
    text_index_state: tauri::State<'_, text_index::TextIndexState>,
    args: qdrant::DeletePointsForIncludePathArgs,
) -> Result<qdrant::DeletePointsForPathsResult, String> {
    let paths =
        qdrant::paths_under_include_root(&app, &state, &args.source_id, &args.include_path).await?;
    let res = if paths.is_empty() {
        qdrant::DeletePointsForPathsResult { deleted_count: 0 }
    } else {
        qdrant::delete_points_for_paths(
            &app,
            &state,
            qdrant::DeletePointsForPathsArgs {
                source_id: args.source_id.clone(),
                paths,
            },
        )
        .await?
    };
    text_index::delete_for_paths_under_include(
        &app,
        &text_index_state,
        &args.source_id,
        std::path::Path::new(&args.include_path),
    )
    .await?;
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
    #[serde(default)]
    pub vision_raster: VisionRasterOptions,
}

#[tauri::command]
async fn start_embedding_job(
    app: tauri::AppHandle,
    embedding_mgr: tauri::State<'_, embedding::EmbeddingManager>,
    qdrant_state: tauri::State<'_, qdrant::QdrantState>,
    args: StartEmbeddingJobArgs,
) -> Result<(), String> {
    let vision_raster = clamp_vision_raster_options(args.vision_raster);
    embedding::start(
        app,
        embedding_mgr,
        qdrant_state,
        args.scan,
        args.source_id,
        vision_raster,
    )
    .await
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

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct GeminiJudgeTagArgs {
    source_id: String,
    source_path: String,
    target_path: String,
    tag_name: String,
    similarity_score: f32,
    #[serde(default)]
    vision_raster: VisionRasterOptions,
}

#[tauri::command]
async fn gemini_judge_tag(
    app: tauri::AppHandle,
    text_index_state: tauri::State<'_, text_index::TextIndexState>,
    args: GeminiJudgeTagArgs,
) -> Result<bool, String> {
    use base64::Engine;

    let vision_raster = clamp_vision_raster_options(args.vision_raster);
    let source_id = args.source_id.clone();

    let get_part = |path: &str| -> Result<serde_json::Value, String> {
        let meta = std::fs::metadata(path).map_err(|e| e.to_string())?;
        let size = meta.len();
        if size > MAX_EMBED_FILE_BYTES {
            return Err("File too large".to_string());
        }
        let ext = std::path::Path::new(path)
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or_default()
            .to_lowercase();

        if ["jpg", "jpeg", "png"].contains(&ext.as_str()) {
            let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
            let (prepared_bytes, mime) =
                embedding::prepare_raster_image_for_gemini(&bytes, &vision_raster)?;
            let b64 = base64::engine::general_purpose::STANDARD.encode(&prepared_bytes);
            Ok(serde_json::json!({
                "inline_data": { "mime_type": mime, "data": b64 }
            }))
        } else {
            // Cannot await inside closure, so we return a marker and handle it outside
            Ok(serde_json::json!({ "fetch_text_for": path }))
        }
    };

    let mut source_part = get_part(&args.source_path)?;
    if source_part.get("fetch_text_for").is_some() {
        let text = text_index::get_full_text_for_path(&app, &text_index_state, &source_id, &args.source_path)
            .await?
            .unwrap_or_else(|| std::fs::read_to_string(&args.source_path).unwrap_or_default());
        let mut text = text;
        if text.len() > 16000 {
            text.truncate(16000);
        }
        source_part = serde_json::json!({ "text": text });
    }

    let mut target_part = get_part(&args.target_path)?;
    if target_part.get("fetch_text_for").is_some() {
        let text = text_index::get_full_text_for_path(&app, &text_index_state, &source_id, &args.target_path)
            .await?
            .unwrap_or_else(|| std::fs::read_to_string(&args.target_path).unwrap_or_default());
        let mut text = text;
        if text.len() > 16000 {
            text.truncate(16000);
        }
        target_part = serde_json::json!({ "text": text });
    }

    embedding::judge_tag(
        &app,
        &args.tag_name,
        args.similarity_score,
        &args.source_path,
        &args.target_path,
        source_part,
        target_part,
    )
    .await
        .map_err(|e| {
            tracing::error!(
                target: crate::logging::TARGET_JUDGE,
                error = %e,
                "judge_tag failed"
            );
            e
        })
}

#[tauri::command]
fn gemini_api_key_status() -> gemini_settings::GeminiApiKeyStatus {
    gemini_settings::api_key_status()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveGeminiApiKeyArgs {
    api_key: String,
}

#[tauri::command]
async fn save_gemini_api_key(
    app: tauri::AppHandle,
    mgr: tauri::State<'_, embedding::EmbeddingManager>,
    args: SaveGeminiApiKeyArgs,
) -> Result<(), String> {
    gemini_settings::save_user_api_key(&app, &args.api_key)?;
    mgr.reset_gemini_client_cache().await;
    Ok(())
}

#[tauri::command]
async fn clear_stored_gemini_api_key(
    app: tauri::AppHandle,
    mgr: tauri::State<'_, embedding::EmbeddingManager>,
) -> Result<(), String> {
    gemini_settings::clear_stored_api_key_file(&app)?;
    mgr.reset_gemini_client_cache().await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        choose_video_thumbnail_seek_seconds, ffmpeg_tool_candidates, ffmpeg_tool_file_name,
        resolve_first_existing_path, thumbnail_supported_file_kind, FfmpegToolLookup,
    };
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_test_dir(prefix: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("manifold-{prefix}-{nonce}"));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn choose_video_thumbnail_seek_seconds_uses_default_when_duration_unknown() {
        assert_eq!(choose_video_thumbnail_seek_seconds(None), 1.0);
    }

    #[test]
    fn choose_video_thumbnail_seek_seconds_clamps_short_and_long_durations() {
        assert_eq!(choose_video_thumbnail_seek_seconds(Some(5.0)), 1.0);
        assert_eq!(choose_video_thumbnail_seek_seconds(Some(400.0)), 30.0);
        assert_eq!(choose_video_thumbnail_seek_seconds(Some(50.0)), 5.0);
    }

    #[test]
    fn resolve_ffmpeg_tool_prefers_override_before_path_fallback() {
        let root = unique_test_dir("ffmpeg-lookup");
        let override_dir = root.join("override");
        let path_dir = root.join("path");
        let file_name = ffmpeg_tool_file_name("ffmpeg");
        fs::create_dir_all(&override_dir).expect("create override dir");
        fs::create_dir_all(&path_dir).expect("create path dir");
        fs::write(override_dir.join(&file_name), b"").expect("write override ffmpeg");
        fs::write(path_dir.join(&file_name), b"").expect("write path ffmpeg");

        let lookup = FfmpegToolLookup {
            override_dir: Some(override_dir.clone()),
            resource_dir: None,
            exe_path: None,
            cwd: None,
            path_dirs: vec![path_dir.clone()],
        };
        let candidates = ffmpeg_tool_candidates("ffmpeg", &lookup);
        let resolved = resolve_first_existing_path(&candidates).expect("resolve ffmpeg");

        assert_eq!(resolved, override_dir.join(file_name));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn thumbnail_supported_file_kind_includes_current_video_types() {
        assert!(thumbnail_supported_file_kind("png"));
        assert!(thumbnail_supported_file_kind("pdf"));
        assert!(thumbnail_supported_file_kind("mp4"));
        assert!(thumbnail_supported_file_kind("mov"));
        assert!(!thumbnail_supported_file_kind("wav"));
    }
}
