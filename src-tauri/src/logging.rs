//! Stable `tracing` targets, `MANIFOLD_LOG` resolution, and local-dev formatting.

use std::{
    fmt as std_fmt,
    path::Path,
    time::{Duration, Instant},
};

use tracing::{
    field::{Field, Visit},
    Event, Subscriber,
};
use tracing_subscriber::{
    fmt::{
        format::{FormatEvent, FormatFields, Writer},
        FmtContext, FormattedFields,
    },
    registry::LookupSpan,
    EnvFilter,
};

pub const TARGET_QDRANT: &str = "manifold::qdrant";
pub const TARGET_EMBEDDING: &str = "manifold::embedding";
pub const TARGET_JUDGE: &str = "manifold::judge";
pub const TARGET_THUMBNAIL: &str = "manifold::thumbnail";

const ALLOWED_LEVELS: &[&str] = &["error", "warn", "info", "debug", "trace"];
const DEFAULT_DIRECTIVES: &str = "error";

/// Build the `EnvFilter` directive string for the tracing subscriber.
///
/// - Unset or empty `MANIFOLD_LOG` → `"error"` (errors only, default).
/// - One of `error`, `warn`, `info`, `debug`, `trace` → `error,manifold={level}` so
///   dependencies stay at error and all `manifold::…` targets use that level.
/// - Any other value → invalid, same as default `"error"`.
pub fn env_filter_directives() -> String {
    env_filter_directives_from(&std::env::var("MANIFOLD_LOG").unwrap_or_default())
}

pub fn init() {
    let env_filter = build_env_filter();
    if cfg!(debug_assertions) {
        let _ = tracing_subscriber::fmt()
            .with_env_filter(env_filter)
            .event_format(DevEventFormat::default())
            .try_init();
    } else {
        let _ = tracing_subscriber::fmt()
            .with_env_filter(env_filter)
            .with_target(true)
            .with_line_number(true)
            .with_file(true)
            .compact()
            .try_init();
    }
}

fn build_env_filter() -> EnvFilter {
    let directives = env_filter_directives();
    EnvFilter::try_new(&directives).unwrap_or_else(|_| EnvFilter::new(DEFAULT_DIRECTIVES))
}

fn env_filter_directives_from(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return DEFAULT_DIRECTIVES.to_string();
    }
    if ALLOWED_LEVELS.iter().any(|&level| level == trimmed) {
        format!("{DEFAULT_DIRECTIVES},manifold={trimmed}")
    } else {
        DEFAULT_DIRECTIVES.to_string()
    }
}

#[derive(Debug, Clone)]
struct DevEventFormat {
    started_at: Instant,
}

impl Default for DevEventFormat {
    fn default() -> Self {
        Self {
            started_at: Instant::now(),
        }
    }
}

impl<S, N> FormatEvent<S, N> for DevEventFormat
where
    S: Subscriber + for<'lookup> LookupSpan<'lookup>,
    N: for<'writer> FormatFields<'writer> + 'static,
{
    fn format_event(
        &self,
        ctx: &FmtContext<'_, S, N>,
        mut writer: Writer<'_>,
        event: &Event<'_>,
    ) -> std_fmt::Result {
        let meta = event.metadata();
        let mut fields = EventFieldCollector::default();
        event.record(&mut fields);

        let timestamp = format_elapsed(self.started_at.elapsed());
        let level = format!("{:>5}", meta.level());
        let target = short_target(meta.target());

        match fields.message.as_deref() {
            Some(message) if !message.is_empty() => {
                writeln!(writer, "{timestamp} {level} {target:<10} {message}")?;
            }
            _ => {
                writeln!(writer, "{timestamp} {level} {target:<10}")?;
            }
        }

        let mut context_rows = Vec::new();
        if let Some(location) = format_location(meta.file(), meta.line()) {
            context_rows.push(("location".to_string(), location));
        }
        if let Some(span_context) = format_span_context::<S, N>(ctx) {
            context_rows.push(("span".to_string(), span_context));
        }

        let width = context_rows
            .iter()
            .chain(fields.entries.iter())
            .map(|(name, _)| name.len())
            .max()
            .unwrap_or(0);

        for (name, value) in context_rows {
            writeln!(writer, "  {name:width$}: {value}", width = width)?;
        }
        for (name, value) in fields.entries {
            writeln!(writer, "  {name:width$}: {value}", width = width)?;
        }
        writeln!(writer)?;

        Ok(())
    }
}

#[derive(Debug, Default)]
struct EventFieldCollector {
    message: Option<String>,
    entries: Vec<(String, String)>,
}

impl EventFieldCollector {
    fn push_value(&mut self, field: &Field, value: String) {
        let name = normalize_field_name(field.name());
        let value = sanitize_log_text(&value);
        if name == "message" {
            self.message = Some(value);
            return;
        }
        self.entries.push((name.to_string(), format_field_value(name, &value)));
    }
}

impl Visit for EventFieldCollector {
    fn record_bool(&mut self, field: &Field, value: bool) {
        self.push_value(field, value.to_string());
    }

    fn record_i64(&mut self, field: &Field, value: i64) {
        self.push_value(field, value.to_string());
    }

    fn record_u64(&mut self, field: &Field, value: u64) {
        self.push_value(field, value.to_string());
    }

    fn record_i128(&mut self, field: &Field, value: i128) {
        self.push_value(field, value.to_string());
    }

    fn record_u128(&mut self, field: &Field, value: u128) {
        self.push_value(field, value.to_string());
    }

    fn record_f64(&mut self, field: &Field, value: f64) {
        self.push_value(field, value.to_string());
    }

    fn record_str(&mut self, field: &Field, value: &str) {
        self.push_value(field, value.to_string());
    }

    fn record_error(&mut self, field: &Field, value: &(dyn std::error::Error + 'static)) {
        self.push_value(field, value.to_string());
    }

    fn record_debug(&mut self, field: &Field, value: &dyn std_fmt::Debug) {
        self.push_value(field, format!("{value:?}"));
    }
}

fn normalize_field_name(name: &str) -> &str {
    name.strip_prefix("r#").unwrap_or(name)
}

fn short_target(target: &str) -> &str {
    target.rsplit("::").next().unwrap_or(target)
}

fn format_elapsed(elapsed: Duration) -> String {
    format!("{:>4}.{:03}s", elapsed.as_secs(), elapsed.subsec_millis())
}

fn format_location(file: Option<&str>, line: Option<u32>) -> Option<String> {
    match (file, line) {
        (Some(file), Some(line)) => Some(format!("{file}:{line}")),
        (Some(file), None) => Some(file.to_string()),
        _ => None,
    }
}

fn format_span_context<S, N>(ctx: &FmtContext<'_, S, N>) -> Option<String>
where
    S: Subscriber + for<'lookup> LookupSpan<'lookup>,
    N: for<'writer> FormatFields<'writer> + 'static,
{
    let scope = ctx.event_scope()?;
    let mut spans = Vec::new();
    for span in scope.from_root() {
        let mut label = span.name().to_string();
        let extensions = span.extensions();
        if let Some(fields) = extensions.get::<FormattedFields<N>>() {
            if !fields.is_empty() {
                label.push('{');
                label.push_str(fields);
                label.push('}');
            }
        }
        spans.push(label);
    }
    if spans.is_empty() {
        None
    } else {
        Some(spans.join(" > "))
    }
}

fn format_field_value(name: &str, value: &str) -> String {
    if name == "path" || name == "file" {
        return shorten_path(value);
    }
    if name.ends_with("_elapsed_ms")
        || name.ends_with("_elapsed_ms_total")
        || name.ends_with("_elapsed_ms_avg")
    {
        if let Ok(ms) = value.parse::<u128>() {
            return humanize_millis(ms);
        }
    }
    if name.ends_with("_bytes") {
        if let Ok(bytes) = value.parse::<u64>() {
            return humanize_bytes(bytes);
        }
    }
    value.to_string()
}

fn sanitize_log_text(value: &str) -> String {
    value
        .replace('\u{1b}', "\\x1b")
        .replace('\r', "\\r")
        .replace('\n', "\\n")
}

fn shorten_path(value: &str) -> String {
    let path = Path::new(value);
    let workspace_root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("src-tauri has a workspace root");

    if let Ok(stripped) = path.strip_prefix(workspace_root) {
        return stripped.display().to_string();
    }
    if let Some(home) = std::env::var_os("HOME") {
        if let Ok(stripped) = path.strip_prefix(home) {
            return format!("~/{}", stripped.display());
        }
    }
    value.to_string()
}

fn humanize_millis(ms: u128) -> String {
    if ms < 1_000 {
        return format!("{ms}ms");
    }
    if ms < 60_000 {
        return format!("{:.3}s", ms as f64 / 1_000.0);
    }

    let total_seconds = ms / 1_000;
    let minutes = total_seconds / 60;
    let seconds = total_seconds % 60;
    let millis = ms % 1_000;
    format!("{minutes}m {seconds:02}.{millis:03}s")
}

fn humanize_bytes(bytes: u64) -> String {
    const KIB: f64 = 1024.0;
    const MIB: f64 = KIB * 1024.0;
    const GIB: f64 = MIB * 1024.0;

    let bytes_f64 = bytes as f64;
    if bytes_f64 >= GIB {
        format!("{:.2} GiB", bytes_f64 / GIB)
    } else if bytes_f64 >= MIB {
        format!("{:.2} MiB", bytes_f64 / MIB)
    } else if bytes_f64 >= KIB {
        format!("{:.2} KiB", bytes_f64 / KIB)
    } else {
        format!("{bytes} B")
    }
}

#[cfg(test)]
mod tests {
    use super::{
        env_filter_directives_from, format_field_value, humanize_bytes, humanize_millis,
        sanitize_log_text, shorten_path, short_target,
    };

    #[test]
    fn env_filter_defaults_to_errors_only() {
        assert_eq!(env_filter_directives_from(""), "error");
        assert_eq!(env_filter_directives_from(" noisy "), "error");
    }

    #[test]
    fn env_filter_scopes_valid_levels_to_manifold_targets() {
        assert_eq!(env_filter_directives_from("info"), "error,manifold=info");
        assert_eq!(env_filter_directives_from("trace"), "error,manifold=trace");
    }

    #[test]
    fn target_is_shortened_to_last_segment() {
        assert_eq!(short_target("manifold::embedding"), "embedding");
        assert_eq!(short_target("embedding"), "embedding");
    }

    #[test]
    fn field_values_are_humanized_for_common_units() {
        assert_eq!(humanize_millis(238), "238ms");
        assert_eq!(humanize_millis(1_478), "1.478s");
        assert_eq!(humanize_millis(79_260), "1m 19.260s");
        assert_eq!(humanize_bytes(117_129), "114.38 KiB");
        assert_eq!(humanize_bytes(1_866_500), "1.78 MiB");
        assert_eq!(format_field_value("file_total_elapsed_ms", "7926"), "7.926s");
        assert_eq!(format_field_value("file_read_bytes", "1866500"), "1.78 MiB");
    }

    #[test]
    fn path_values_are_shortened_when_inside_known_roots() {
        let workspace_path =
            "/Users/sagarchethankumar/Documents/projects/manifold/src/components/App.tsx";
        let home_path = "/Users/sagarchethankumar/Downloads/test.txt";

        assert_eq!(shorten_path(workspace_path), "src/components/App.tsx");
        assert_eq!(shorten_path(home_path), "~/Downloads/test.txt");
        assert_eq!(shorten_path("/tmp/test.txt"), "/tmp/test.txt");
    }

    #[test]
    fn log_text_is_sanitized_for_terminal_output() {
        assert_eq!(
            sanitize_log_text("line 1\nline 2\r\n\x1b[31mred"),
            "line 1\\nline 2\\r\\n\\x1b[31mred"
        );
    }
}
