use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;
use tauri::Manager;

const INDEX_FILE_NAME: &str = "text_index_v1.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertTextArgs {
    pub source_id: String,
    pub path: String,
    pub content_hash: String,
    pub raw_text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchTextArgs {
    pub source_id: String,
    pub query: String,
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextSearchHit {
    pub path: String,
    pub content_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct IndexEntry {
    pub(crate) source_id: String,
    pub(crate) path: String,
    pub(crate) content_hash: String,
    #[serde(default)]
    pub(crate) raw_text: String,
    pub(crate) normalized_text: String,
}


#[derive(Default, Debug)]
pub struct TextIndexState {
    pub entries: Arc<RwLock<Option<Vec<IndexEntry>>>>,
}

fn normalize_for_match(value: &str) -> String {
    let mut normalized = String::with_capacity(value.len());
    let mut prev_is_alpha = false;
    let mut prev_is_digit = false;
    for c in value.chars() {
        if c.is_alphanumeric() {
            let is_alpha = c.is_ascii_alphabetic();
            let is_digit = c.is_ascii_digit();
            if !normalized.is_empty() && ((prev_is_alpha && is_digit) || (prev_is_digit && is_alpha)) {
                normalized.push(' ');
            }
            normalized.push(c.to_ascii_lowercase());
            prev_is_alpha = is_alpha;
            prev_is_digit = is_digit;
        } else {
            normalized.push(' ');
            prev_is_alpha = false;
            prev_is_digit = false;
        }
    }
    normalized
        .split_whitespace()
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

fn index_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to resolve app data directory: {e}"))?;
    std::fs::create_dir_all(&base).map_err(|e| format!("failed to create app data directory: {e}"))?;
    Ok(base.join(INDEX_FILE_NAME))
}

async fn ensure_loaded(app: &tauri::AppHandle, state: &TextIndexState) -> Result<(), String> {
    let mut lock = state.entries.write().await;
    if lock.is_some() {
        return Ok(());
    }

    let p = index_path(app)?;
    if !p.exists() {
        *lock = Some(Vec::new());
        return Ok(());
    }
    let raw = std::fs::read_to_string(&p).map_err(|e| format!("failed to read text index: {e}"))?;
    if raw.trim().is_empty() {
        *lock = Some(Vec::new());
        return Ok(());
    }
    let entries: Vec<IndexEntry> = serde_json::from_str(&raw).map_err(|e| format!("failed to decode text index: {e}"))?;
    *lock = Some(entries);
    Ok(())
}

fn save_entries(app: &tauri::AppHandle, entries: &[IndexEntry]) -> Result<(), String> {
    let p = index_path(app)?;
    let raw = serde_json::to_string(entries).map_err(|e| format!("failed to encode text index: {e}"))?;
    std::fs::write(p, raw).map_err(|e| format!("failed to write text index: {e}"))
}

#[cfg(test)]
pub fn normalize_text(value: &str) -> String {
    normalize_for_match(value)
}

pub async fn upsert_text(app: &tauri::AppHandle, state: &TextIndexState, args: UpsertTextArgs) -> Result<(), String> {
    ensure_loaded(app, state).await?;
    let mut lock = state.entries.write().await;
    let entries = lock.as_mut().unwrap();
    entries.retain(|e| !(e.source_id == args.source_id && e.path == args.path));
    entries.push(IndexEntry {
        source_id: args.source_id,
        path: args.path,
        content_hash: args.content_hash,
        raw_text: args.raw_text.clone(),
        normalized_text: normalize_for_match(&args.raw_text),
    });
    save_entries(app, entries)
}

pub async fn get_full_text_for_path(
    app: &tauri::AppHandle,
    state: &TextIndexState,
    source_id: &str,
    path: &str,
) -> Result<Option<String>, String> {
    ensure_loaded(app, state).await?;
    let lock = state.entries.read().await;
    let entries = lock.as_ref().unwrap();
    let value = entries
        .iter()
        .find(|e| e.source_id == source_id && e.path == path)
        .map(|e| if e.raw_text.is_empty() { e.normalized_text.clone() } else { e.raw_text.clone() });
    Ok(value)
}

pub async fn delete_all_for_source(app: &tauri::AppHandle, state: &TextIndexState, source_id: &str) -> Result<(), String> {
    ensure_loaded(app, state).await?;
    let mut lock = state.entries.write().await;
    let entries = lock.as_mut().unwrap();
    entries.retain(|e| e.source_id != source_id);
    save_entries(app, entries)
}

pub async fn delete_for_paths(app: &tauri::AppHandle, state: &TextIndexState, source_id: &str, paths: &[String]) -> Result<(), String> {
    ensure_loaded(app, state).await?;
    let path_set: HashSet<&str> = paths.iter().map(String::as_str).collect();
    let mut lock = state.entries.write().await;
    let entries = lock.as_mut().unwrap();
    entries.retain(|e| !(e.source_id == source_id && path_set.contains(e.path.as_str())));
    save_entries(app, entries)
}

pub async fn search_text(app: &tauri::AppHandle, state: &TextIndexState, args: SearchTextArgs) -> Result<Vec<TextSearchHit>, String> {
    ensure_loaded(app, state).await?;
    let normalized_query = normalize_for_match(&args.query);
    if normalized_query.is_empty() {
        return Ok(Vec::new());
    }
    let query_terms: Vec<&str> = normalized_query
        .split_whitespace()
        .filter(|t| !t.is_empty())
        .collect();
    if query_terms.is_empty() {
        return Ok(Vec::new());
    }
    let limit = args.limit.unwrap_or(32).clamp(1, 256) as usize;
    let mut out = Vec::new();
    
    let lock = state.entries.read().await;
    let entries = lock.as_ref().unwrap();
    
    for entry in entries {
        if entry.source_id != args.source_id {
            continue;
        }
        // Entry is already normalized, check if all query terms are present as whole words
        let terms_source = &entry.normalized_text;
        
        // Use word boundaries by checking surrounding characters or just splitting
        // Since terms_source is already normalized (space-separated), we can split it
        let entry_words: HashSet<&str> = terms_source.split_whitespace().collect();
        
        if query_terms.iter().all(|q| entry_words.contains(q)) {
            out.push(TextSearchHit {
                path: entry.path.clone(),
                content_hash: entry.content_hash.clone(),
            });
            if out.len() >= limit {
                break;
            }
        }
    }
    Ok(out)
}


#[cfg(test)]
mod tests {
    use super::normalize_text;

    #[test]
    fn normalize_collapses_whitespace_and_case() {
        let got = normalize_text("  HeLLo\n\n   WoRLD\t from   MANIFOLD ");
        assert_eq!(got, "hello world from manifold");
    }
}
