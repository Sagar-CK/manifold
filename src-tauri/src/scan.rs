use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use walkdir::WalkDir;

use crate::qdrant;

const SCAN_HASH_MAX_BYTES: u64 = 1024 * 1024 * 128;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanFilesArgs {
    pub include: Vec<String>,
    pub exclude: Vec<String>,
    pub extensions: Vec<String>,
    #[serde(default = "default_true")]
    pub use_default_folder_excludes: bool,
}

#[derive(Debug, Clone)]
pub struct ScanWalkCandidate {
    pub path: PathBuf,
    pub size_bytes: u64,
    pub mtime_ms: i64,
    pub ext: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScannedFile {
    pub path: String,
    pub size_bytes: u64,
    pub mtime_ms: i64,
    pub sha256: String,
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

fn default_true() -> bool {
    true
}

/// Max file size (bytes) eligible for embedding and embed preflight scans.
pub const MAX_EMBED_FILE_BYTES: u64 = 25 * 1024 * 1024;

fn default_folder_exclude_segments() -> &'static [String] {
    static DEFAULTS: OnceLock<Vec<String>> = OnceLock::new();
    DEFAULTS.get_or_init(|| {
        serde_json::from_str(include_str!("../../shared/default-folder-excludes.json"))
            .expect("shared/default-folder-excludes.json must be valid")
    })
}

fn path_has_default_excluded_segment(path: &Path) -> bool {
    for c in path.components() {
        if let std::path::Component::Normal(os) = c {
            let Some(name) = os.to_str() else {
                continue;
            };
            if default_folder_exclude_segments()
                .iter()
                .any(|seg| name.eq_ignore_ascii_case(seg))
            {
                return true;
            }
        }
    }
    false
}

fn file_mtime_ms(meta: &std::fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn is_under_dir(path: &Path, dir: &Path) -> bool {
    path.starts_with(dir)
}

fn is_walk_permission_denied(err: &walkdir::Error) -> bool {
    use std::io::ErrorKind;
    err.io_error()
        .is_some_and(|e| matches!(e.kind(), ErrorKind::PermissionDenied))
}

pub fn normalize_ext(s: &str) -> String {
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

pub fn is_path_excluded(
    path: &Path,
    user_excludes: &[PathBuf],
    use_default_folder_excludes: bool,
) -> bool {
    if user_excludes.iter().any(|ex| is_under_dir(path, ex)) {
        return true;
    }
    use_default_folder_excludes && path_has_default_excluded_segment(path)
}

fn collect_scan_candidates(
    args: &ScanFilesArgs,
    max_file_bytes: u64,
) -> Result<Vec<ScanWalkCandidate>, String> {
    let include_dirs: Vec<PathBuf> = args.include.iter().map(PathBuf::from).collect();
    let exclude_dirs: Vec<PathBuf> = args.exclude.iter().map(PathBuf::from).collect();
    let allowed_exts: HashSet<String> = args.extensions.iter().map(|e| normalize_ext(e)).collect();

    let mut out: Vec<ScanWalkCandidate> = Vec::new();
    let mut seen_paths: HashSet<String> = HashSet::new();

    for root in include_dirs {
        if !root.exists() {
            continue;
        }
        for entry in WalkDir::new(&root)
            .follow_links(false)
            .into_iter()
            .filter_entry(|e| {
                if e.file_type().is_dir() {
                    !is_path_excluded(
                        e.path(),
                        &exclude_dirs,
                        args.use_default_folder_excludes,
                    )
                } else {
                    true
                }
            })
        {
            let entry = match entry {
                Ok(entry) => entry,
                Err(err) => {
                    if !is_walk_permission_denied(&err) {
                        // Skip non-permission walk errors.
                    }
                    continue;
                }
            };
            if !entry.file_type().is_file() {
                continue;
            }

            let path = entry.path();
            if is_path_excluded(path, &exclude_dirs, args.use_default_folder_excludes) {
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

            let meta = match fs::metadata(path) {
                Ok(meta) => meta,
                Err(_) => continue,
            };
            if meta.len() > max_file_bytes {
                continue;
            }

            out.push(ScanWalkCandidate {
                path: path.to_path_buf(),
                size_bytes: meta.len(),
                mtime_ms: file_mtime_ms(&meta),
                ext,
            });
        }
    }

    Ok(out)
}

fn scan_files_from_candidates(candidates: Vec<ScanWalkCandidate>) -> Result<Vec<ScannedFile>, String> {
    let mut out = Vec::with_capacity(candidates.len());
    for candidate in candidates {
        let sha256 = compute_sha256(&candidate.path, SCAN_HASH_MAX_BYTES)?;
        out.push(ScannedFile {
            path: candidate.path.to_string_lossy().to_string(),
            size_bytes: candidate.size_bytes,
            mtime_ms: candidate.mtime_ms,
            sha256,
        });
    }
    Ok(out)
}

fn scan_count_from_candidates(candidates: &[ScanWalkCandidate]) -> ScanFilesCountResult {
    ScanFilesCountResult {
        total: candidates.len() as u64,
    }
}

fn scan_estimate_from_candidates(candidates: &[ScanWalkCandidate]) -> ScanFilesEstimateResult {
    let mut image_files = 0u64;
    let mut audio_files = 0u64;
    let mut video_files = 0u64;
    let mut text_like_files = 0u64;
    let mut total_text_bytes = 0u64;
    let mut total_audio_bytes = 0u64;
    let mut total_video_bytes = 0u64;

    for candidate in candidates {
        match candidate.ext.as_str() {
            "png" | "jpg" | "jpeg" => {
                image_files = image_files.saturating_add(1);
            }
            "mp3" | "wav" => {
                audio_files = audio_files.saturating_add(1);
                total_audio_bytes = total_audio_bytes.saturating_add(candidate.size_bytes);
            }
            "mp4" | "mov" => {
                video_files = video_files.saturating_add(1);
                total_video_bytes = total_video_bytes.saturating_add(candidate.size_bytes);
            }
            _ => {
                text_like_files = text_like_files.saturating_add(1);
                total_text_bytes = total_text_bytes.saturating_add(candidate.size_bytes);
            }
        }
    }

    ScanFilesEstimateResult {
        total: candidates.len() as u64,
        image_files,
        audio_files,
        video_files,
        text_like_files,
        total_text_bytes,
        total_audio_bytes,
        total_video_bytes,
    }
}

/// Walk include roots and return file candidates (extension filter, excludes, size cap).
pub fn walk_scan_candidates(
    args: &ScanFilesArgs,
    max_file_bytes: u64,
) -> Result<Vec<ScanWalkCandidate>, String> {
    collect_scan_candidates(args, max_file_bytes)
}

/// Returns true if any candidate still needs content or metadata embedding (uses preflight index + hash).
pub fn any_candidate_needs_embedding(
    candidates: Vec<ScanWalkCandidate>,
    index: qdrant::SourcePreflightIndex,
) -> Result<bool, String> {
    for candidate in candidates {
        let path_str = candidate.path.to_string_lossy().to_string();
        let content_hash = if let Some(hash) = qdrant::reuse_hash_if_fingerprint_matches(
            &path_str,
            candidate.size_bytes,
            candidate.mtime_ms,
            &index,
        ) {
            hash
        } else {
            compute_sha256(&candidate.path, SCAN_HASH_MAX_BYTES)?
        };
        let decision = qdrant::decide_embedding_need_from_index(&path_str, &content_hash, &index);
        if decision.should_embed_content || decision.should_embed_metadata {
            return Ok(true);
        }
    }
    Ok(false)
}

pub fn compute_sha256(path: &Path, max_bytes: u64) -> Result<String, String> {
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
pub async fn scan_files(args: ScanFilesArgs) -> Result<Vec<ScannedFile>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let candidates = collect_scan_candidates(&args, SCAN_HASH_MAX_BYTES)?;
        scan_files_from_candidates(candidates)
    })
    .await
    .map_err(|e| format!("scan_files: task join error: {e}"))?
}

#[tauri::command]
pub async fn scan_files_count(args: ScanFilesArgs) -> Result<ScanFilesCountResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let candidates = collect_scan_candidates(&args, u64::MAX)?;
        Ok(scan_count_from_candidates(&candidates))
    })
    .await
    .map_err(|e| format!("scan_files_count: task join error: {e}"))?
}

#[tauri::command]
pub async fn scan_files_estimate(args: ScanFilesArgs) -> Result<ScanFilesEstimateResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let candidates = collect_scan_candidates(&args, u64::MAX)?;
        Ok(scan_estimate_from_candidates(&candidates))
    })
    .await
    .map_err(|e| format!("scan_files_estimate: task join error: {e}"))?
}

#[tauri::command]
pub async fn scan_files_needs_embedding(
    app: tauri::AppHandle,
    state: tauri::State<'_, qdrant::QdrantState>,
    args: ScanFilesNeedsEmbeddingArgs,
) -> Result<ScanFilesNeedsEmbeddingResult, String> {
    let scan = args.scan.clone();
    let candidates = tauri::async_runtime::spawn_blocking(move || {
        walk_scan_candidates(&scan, MAX_EMBED_FILE_BYTES)
    })
    .await
    .map_err(|e| format!("scan_files_needs_embedding: join error: {e}"))??;

    let total_selected = candidates.len() as u64;

    if candidates.is_empty() {
        return Ok(ScanFilesNeedsEmbeddingResult {
            total_selected,
            needs_embedding: false,
        });
    }

    let index = qdrant::load_source_preflight_index(&app, &state, &args.source_id).await?;
    let needs_embedding = tauri::async_runtime::spawn_blocking(move || {
        any_candidate_needs_embedding(candidates, index)
    })
    .await
    .map_err(|e| format!("scan_files_needs_embedding: join error: {e}"))??;

    Ok(ScanFilesNeedsEmbeddingResult {
        total_selected,
        needs_embedding,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        default_folder_exclude_segments, is_path_excluded, normalize_ext, normalize_path_key,
        scan_estimate_from_candidates, ScanWalkCandidate,
    };
    use std::path::{Path, PathBuf};

    #[test]
    fn default_excludes_are_loaded_from_shared_json() {
        let excludes = default_folder_exclude_segments();
        assert!(excludes.iter().any(|item| item == "node_modules"));
        assert!(excludes.iter().any(|item| item == ".git"));
    }

    #[test]
    fn path_exclusion_respects_shared_default_segments() {
        let path = Path::new("/tmp/project/node_modules/pkg/index.js");
        assert!(is_path_excluded(path, &[], true));
        assert!(!is_path_excluded(path, &[], false));
    }

    #[test]
    fn estimate_derivation_uses_candidate_extensions_and_sizes() {
        let candidates = vec![
            ScanWalkCandidate {
                path: PathBuf::from("/tmp/a.png"),
                size_bytes: 10,
                mtime_ms: 1,
                ext: "png".to_string(),
            },
            ScanWalkCandidate {
                path: PathBuf::from("/tmp/b.mp3"),
                size_bytes: 20,
                mtime_ms: 1,
                ext: "mp3".to_string(),
            },
            ScanWalkCandidate {
                path: PathBuf::from("/tmp/c.pdf"),
                size_bytes: 30,
                mtime_ms: 1,
                ext: "pdf".to_string(),
            },
        ];

        let estimate = scan_estimate_from_candidates(&candidates);
        assert_eq!(estimate.total, 3);
        assert_eq!(estimate.image_files, 1);
        assert_eq!(estimate.audio_files, 1);
        assert_eq!(estimate.video_files, 0);
        assert_eq!(estimate.text_like_files, 1);
        assert_eq!(estimate.total_audio_bytes, 20);
        assert_eq!(estimate.total_text_bytes, 30);
    }

    #[test]
    fn path_and_extension_normalization_stay_stable() {
        assert_eq!(normalize_ext(".PDF "), "pdf");
        assert_eq!(
            normalize_path_key(Path::new("C:\\Users\\Me\\Project\\")),
            "c:/users/me/project"
        );
    }
}
