//! Stable `tracing` targets and `MANIFOLD_LOG` resolution.

pub const TARGET_QDRANT: &str = "manifold::qdrant";
pub const TARGET_EMBEDDING: &str = "manifold::embedding";
pub const TARGET_JUDGE: &str = "manifold::judge";
pub const TARGET_THUMBNAIL: &str = "manifold::thumbnail";

const ALLOWED_LEVELS: &[&str] = &["error", "warn", "info", "debug", "trace"];

/// Build the `EnvFilter` directive string for the tracing subscriber.
///
/// - Unset or empty `MANIFOLD_LOG` → `"error"` (errors only, default).
/// - One of `error`, `warn`, `info`, `debug`, `trace` → `error,manifold={level}` so
///   dependencies stay at error and all `manifold::…` targets use that level.
/// - Any other value → invalid, same as default `"error"`.
pub fn env_filter_directives() -> String {
    let raw = std::env::var("MANIFOLD_LOG").unwrap_or_default();
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return "error".to_string();
    }
    if ALLOWED_LEVELS.iter().any(|&l| l == trimmed) {
        format!("error,manifold={trimmed}")
    } else {
        "error".to_string()
    }
}
