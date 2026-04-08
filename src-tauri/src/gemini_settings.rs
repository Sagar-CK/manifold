use serde::Serialize;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;

const FILENAME: &str = "gemini_api_key";

static GEMINI_KEY_PATH: Mutex<Option<PathBuf>> = Mutex::new(None);

pub fn init_storage(app: &tauri::AppHandle) {
    if let Ok(dir) = app.path().app_data_dir() {
        if let Ok(mut guard) = GEMINI_KEY_PATH.lock() {
            if guard.is_none() {
                *guard = Some(dir.join(FILENAME));
            }
        }
    }
}

fn resolve_key_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data directory: {e}"))?;
    Ok(dir.join(FILENAME))
}

/// Key from app data file; [init_storage] should run at startup (path is also set by [save_user_api_key]).
pub fn read_stored_key() -> Option<String> {
    let path = GEMINI_KEY_PATH.lock().ok().and_then(|g| g.clone())?;
    std::fs::read_to_string(&path)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

pub fn env_has_gemini_key() -> bool {
    std::env::var("MANIFOLD_GEMINI_API_KEY")
        .ok()
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeminiApiKeyStatus {
    pub configured: bool,
    pub source: GeminiApiKeySource,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub enum GeminiApiKeySource {
    Environment,
    AppStorage,
    None,
}

pub fn api_key_status() -> GeminiApiKeyStatus {
    if env_has_gemini_key() {
        return GeminiApiKeyStatus {
            configured: true,
            source: GeminiApiKeySource::Environment,
        };
    }
    if read_stored_key().is_some() {
        return GeminiApiKeyStatus {
            configured: true,
            source: GeminiApiKeySource::AppStorage,
        };
    }
    GeminiApiKeyStatus {
        configured: false,
        source: GeminiApiKeySource::None,
    }
}

pub fn save_user_api_key(app: &tauri::AppHandle, api_key: &str) -> Result<(), String> {
    let trimmed = api_key.trim();
    if trimmed.is_empty() {
        return Err("API key cannot be empty.".to_string());
    }
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data directory: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(FILENAME);
    std::fs::write(&path, trimmed).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::Permissions::from_mode(0o600);
        std::fs::set_permissions(&path, mode).map_err(|e| e.to_string())?;
    }
    if let Ok(mut guard) = GEMINI_KEY_PATH.lock() {
        *guard = Some(path);
    }
    Ok(())
}

pub fn clear_stored_api_key_file(app: &tauri::AppHandle) -> Result<(), String> {
    let path = resolve_key_path(app)?;
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::env_has_gemini_key;
    use std::sync::Mutex;

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn env_status_only_uses_the_canonical_gemini_variable() {
        let _guard = ENV_LOCK.lock().expect("env lock");

        std::env::remove_var("MANIFOLD_GEMINI_API_KEY");
        std::env::remove_var("GOOGLE_GENERATIVE_AI_API_KEY");
        assert!(!env_has_gemini_key());

        std::env::set_var("GOOGLE_GENERATIVE_AI_API_KEY", "legacy-key");
        assert!(!env_has_gemini_key());

        std::env::set_var("MANIFOLD_GEMINI_API_KEY", "current-key");
        assert!(env_has_gemini_key());

        std::env::remove_var("MANIFOLD_GEMINI_API_KEY");
        std::env::remove_var("GOOGLE_GENERATIVE_AI_API_KEY");
    }
}
