use serde::{Deserialize, Serialize};
use std::fs;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::Duration;
use tauri::AppHandle;
use tauri::Manager;
use tokio::sync::Mutex;

use qdrant_client::Qdrant;
use qdrant_client::qdrant::{
    Condition, CreateCollectionBuilder, Distance, Filter, PointStruct, ScrollPointsBuilder,
    SearchPointsBuilder, UpsertPointsBuilder, VectorParamsBuilder, DeletePointsBuilder,
    CountPointsBuilder, PointId
};
use qdrant_client::Payload;

const CONTENT_COLLECTION_NAME: &str = "manifold_files_content_v2";
const METADATA_COLLECTION_NAME: &str = "manifold_files_metadata_v2";
const VECTOR_DIM: usize = 3072;
const CONNECT_COOLDOWN: Duration = Duration::from_secs(15);

// Stable app-specific UUID namespace (generated once).
const POINT_ID_NAMESPACE: uuid::Uuid = uuid::uuid!("7c3a7e71-3cdd-4ad2-8a4a-596d4d48226e");

pub struct QdrantState {
    inner: Mutex<Option<QdrantInstance>>,
    last_failed_at: Mutex<Option<std::time::Instant>>,
    last_error: Mutex<Option<String>>,
    runtime: Mutex<QdrantRuntimeState>,
}

impl Default for QdrantState {
    fn default() -> Self {
        Self {
            inner: Mutex::new(None),
            last_failed_at: Mutex::new(None),
            last_error: Mutex::new(None),
            runtime: Mutex::new(QdrantRuntimeState::default()),
        }
    }
}

struct QdrantInstance {
    client: Qdrant,
}

#[derive(Debug, Default)]
struct QdrantRuntimeState {
    child: Option<Child>,
    base_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertMetadataArgs {
    pub source_id: String,
    pub path: String,
    pub content_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertMetadataResult {
    pub should_embed_content: bool,
    pub should_embed_metadata: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertEmbeddingArgs {
    pub source_id: String,
    pub path: String,
    pub content_hash: String,
    pub embedding: Vec<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertMetadataEmbeddingArgs {
    pub source_id: String,
    pub path: String,
    pub content_hash: String,
    pub metadata_embedding: Vec<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticSearchArgs {
    pub source_id: String,
    pub query_vector: Vec<f32>,
    pub limit: Option<u32>,
    pub channel: Option<SemanticSearchChannel>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SemanticSearchChannel {
    Content,
    Metadata,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SemanticSearchHit {
    pub score: f32,
    pub file: SemanticSearchFile,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticSearchFile {
    pub path: String,
    pub content_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CountPointsArgs {
    pub source_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CountPointsResult {
    pub count: u64,
}

fn point_id(source_id: &str, path: &str) -> PointId {
    let id = uuid::Uuid::new_v5(&POINT_ID_NAMESPACE, format!("{source_id}:{path}").as_bytes());
    PointId::from(id.to_string())
}

fn build_qdrant_client(url: &str, timeout_ms: u64, connect_timeout_ms: Option<u64>) -> Result<Qdrant, String> {
    let mut builder = Qdrant::from_url(url).timeout(Duration::from_millis(timeout_ms));
    
    // Disable startup version check that logs spam when local process is booting
    builder.check_compatibility = false;

    if let Some(ct) = connect_timeout_ms {
        builder = builder.connect_timeout(Duration::from_millis(ct));
    }

    if let Ok(api_key) = std::env::var("MANIFOLD_QDRANT_API_KEY") {
        let trimmed = api_key.trim();
        if !trimmed.is_empty() {
            builder = builder.api_key(trimmed);
        }
    }

    builder.build().map_err(|e| e.to_string())
}

async fn quick_ready(client: &Qdrant) -> Result<(), String> {
    client.health_check().await.map_err(|e| format!("Qdrant not ready: {e}"))?;
    Ok(())
}

async fn ensure_collection(client: &Qdrant, collection_name: &str) -> Result<(), String> {
    let exists = client
        .collection_exists(collection_name)
        .await
        .map_err(|e| format!("ensure_collection preflight failed: {e}"))?;

    if exists {
        // In existing implementation we checked if the dimension was wrong and deleted it.
        // We skip it here to simplify.
        return Ok(());
    }

    client
        .create_collection(
            CreateCollectionBuilder::new(collection_name)
                .vectors_config(VectorParamsBuilder::new(VECTOR_DIM as u64, Distance::Cosine)),
        )
        .await
        .map_err(|e| format!("ensure_collection create request failed: {e}"))?;

    Ok(())
}

fn configured_qdrant_url() -> Option<String> {
    // Escape hatch for direct gRPC
    if let Ok(grpc_override) = std::env::var("MANIFOLD_QDRANT_GRPC_URL") {
        let trimmed = grpc_override.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }

    let url = std::env::var("MANIFOLD_QDRANT_URL").unwrap_or_default();
    let trimmed = url.trim().to_string();
    if trimmed.is_empty() {
        return None;
    }

    // Heuristic: swap 6333 (http) to 6334 (grpc)
    if let Ok(mut parsed_url) = url::Url::parse(&trimmed) {
        if parsed_url.port() == Some(6333) {
            let _ = parsed_url.set_port(Some(6334));
            return Some(parsed_url.to_string());
        }
    }

    Some(trimmed)
}

fn find_available_port(start: u16) -> Result<u16, String> {
    for offset in 0..32 {
        let port = start.saturating_add(offset);
        if TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return Ok(port);
        }
    }
    Err(format!("No free TCP port found near {start}"))
}

fn qdrant_binary_file_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "qdrant.exe"
    } else {
        "qdrant"
    }
}

fn resolve_qdrant_binary_path(app: &AppHandle) -> Result<PathBuf, String> {
    let file_name = qdrant_binary_file_name();
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("qdrant").join(file_name));
        candidates.push(resource_dir.join(file_name));
    }
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            candidates.push(exe_dir.join("qdrant").join(file_name));
            candidates.push(exe_dir.join(file_name));
            if let Some(src_tauri_dir) = exe_dir.parent().and_then(|p| p.parent()) {
                candidates.push(src_tauri_dir.join("resources").join("qdrant").join(file_name));
            }
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("src-tauri").join("resources").join("qdrant").join(file_name));
    }

    for path in candidates {
        if path.exists() {
            return Ok(path);
        }
    }
    Err(format!(
        "Qdrant binary was not found. Run `pnpm setup:binaries` to install {}.",
        file_name
    ))
}

async fn ensure_runtime_base_url(app: &AppHandle, state: &QdrantState) -> Result<String, String> {
    {
        let mut runtime = state.runtime.lock().await;
        if let Some(child) = runtime.child.as_mut() {
            if let Some(status) = child
                .try_wait()
                .map_err(|e| format!("Failed to inspect Qdrant process: {e}"))?
            {
                runtime.child = None;
                runtime.base_url = None;
                return Err(format!(
                    "Bundled Qdrant exited unexpectedly with status {status}. Check application logs."
                ));
            }
        }
        if let Some(base_url) = runtime.base_url.clone() {
            return Ok(base_url);
        }
    }

    let default_url = "http://127.0.0.1:6334".to_string(); // grpc default
    let default_client = build_qdrant_client(&default_url, 500, None)?;

    if quick_ready(&default_client).await.is_ok() {
        let mut runtime = state.runtime.lock().await;
        runtime.base_url = Some(default_url.clone());
        return Ok(default_url);
    }

    let http_port = find_available_port(6333)?;
    let grpc_port = find_available_port(http_port.saturating_add(1).max(6334))?;
    let binary = resolve_qdrant_binary_path(app)?;
    let storage_path = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Unable to resolve app data dir for Qdrant storage: {e}"))?
        .join("qdrant")
        .join("storage");
    fs::create_dir_all(&storage_path).map_err(|e| format!("Failed to create Qdrant storage dir: {e}"))?;

    let mut command = Command::new(&binary);
    command
        .env("QDRANT__STORAGE__STORAGE_PATH", &storage_path)
        .env("QDRANT__SERVICE__HTTP_PORT", format!("{http_port}"))
        .env("QDRANT__SERVICE__GRPC_PORT", format!("{grpc_port}"))
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let child = command
        .spawn()
        .map_err(|e| format!("Failed to start bundled Qdrant from {}: {e}", binary.display()))?;
    let base_url = format!("http://127.0.0.1:{grpc_port}");
    {
        let mut runtime = state.runtime.lock().await;
        runtime.child = Some(child);
        runtime.base_url = Some(base_url.clone());
    }

    let client = build_qdrant_client(&base_url, 500, None)?;

    for _ in 0..30 {
        if quick_ready(&client).await.is_ok() {
            return Ok(base_url);
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    Err(format!(
        "Bundled Qdrant failed to become ready at {base_url}. Check logs and binary compatibility."
    ))
}

async fn start_qdrant(app: &AppHandle, state: &QdrantState) -> Result<QdrantInstance, String> {
    let trimmed = if let Some(url) = configured_qdrant_url() {
        url
    } else {
        ensure_runtime_base_url(app, state).await?
    };
    
    let client = build_qdrant_client(&trimmed, 5000, Some(350))?;

    quick_ready(&client).await?;
    ensure_collection(&client, CONTENT_COLLECTION_NAME).await?;
    ensure_collection(&client, METADATA_COLLECTION_NAME).await?;
    Ok(QdrantInstance { client })
}

async fn instance(app: &AppHandle, state: &QdrantState) -> Result<Qdrant, String> {
    if let Some(at) = *state.last_failed_at.lock().await {
        if at.elapsed() < CONNECT_COOLDOWN {
            let msg = state
                .last_error
                .lock()
                .await
                .clone()
                .unwrap_or_else(|| "Qdrant is not reachable (cooldown active).".to_string());
            return Err(msg);
        }
    }

    let mut guard = state.inner.lock().await;
    if guard.is_none() {
        match start_qdrant(app, state).await {
            Ok(inst) => {
                *guard = Some(inst);
                *state.last_failed_at.lock().await = None;
                *state.last_error.lock().await = None;
            }
            Err(e) => {
                *state.last_failed_at.lock().await = Some(std::time::Instant::now());
                *state.last_error.lock().await = Some(e.clone());
                return Err(e);
            }
        }
    }
    let inst = guard.as_ref().expect("just set");
    Ok(inst.client.clone())
}

fn file_payload(source_id: &str, path: &str, content_hash: &str) -> Payload {
    let file_name = std::path::Path::new(path)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or_default()
        .to_string();
    let extension = std::path::Path::new(path)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    let mut payload = Payload::new();
    payload.insert("sourceId", source_id.to_string());
    payload.insert("path", path.to_string());
    payload.insert("contentHash", content_hash.to_string());
    payload.insert("fileName", file_name);
    payload.insert("extension", extension);
    payload
}

async fn find_content_vector_by_hash(
    client: &Qdrant,
    source_id: &str,
    content_hash: &str,
) -> Result<Option<Vec<f32>>, String> {
    let filter = Filter::must([
        Condition::matches("sourceId", source_id.to_string()),
        Condition::matches("contentHash", content_hash.to_string()),
    ]);

    let res = client
        .scroll(
            ScrollPointsBuilder::new(CONTENT_COLLECTION_NAME)
                .limit(1)
                .with_vectors(true)
                .with_payload(false)
                .filter(filter),
        )
        .await
        .map_err(|e| format!("qdrant scroll request failed: {e}"))?;

    let Some(point) = res.result.into_iter().next() else {
        return Ok(None);
    };

    let Some(vectors) = point.vectors else {
        return Ok(None);
    };

    use qdrant_client::qdrant::vectors_output::VectorsOptions;
    let vector = match vectors.vectors_options {
        Some(VectorsOptions::Vector(v)) => match v.vector {
            Some(qdrant_client::qdrant::vector_output::Vector::Dense(d)) => d.data,
            _ => return Ok(None),
        },
        Some(VectorsOptions::Vectors(v)) => {
            if let Some(v) = v.vectors.values().next() {
                match &v.vector {
                    Some(qdrant_client::qdrant::vector_output::Vector::Dense(d)) => d.data.clone(),
                    _ => return Ok(None),
                }
            } else {
                return Ok(None);
            }
        }
        None => return Ok(None),
    };

    if vector.len() == VECTOR_DIM {
        return Ok(Some(vector));
    }
    
    Ok(None)
}

async fn upsert_content_vector_for_path(
    client: &Qdrant,
    source_id: &str,
    path: &str,
    content_hash: &str,
    embedding: &[f32],
) -> Result<(), String> {
    let id = point_id(source_id, path);
    let payload = file_payload(source_id, path, content_hash);

    let point = PointStruct::new(id, embedding.to_vec(), payload);
    
    client
        .upsert_points(UpsertPointsBuilder::new(CONTENT_COLLECTION_NAME, vec![point]).wait(true))
        .await
        .map_err(|e| format!("qdrant content copy upsert request failed: {e}"))?;
        
    Ok(())
}

fn hash_prefix(value: &str) -> &str {
    let n = std::cmp::min(12, value.len());
    &value[..n]
}

pub async fn upsert_metadata(app: &AppHandle, state: &QdrantState, args: UpsertMetadataArgs) -> Result<UpsertMetadataResult, String> {
    let client = instance(app, state).await?;
    let id = point_id(&args.source_id, &args.path);

    use qdrant_client::qdrant::GetPointsBuilder;

    let mut content_point = None;
    let mut metadata_point = None;

    if let Ok(res) = client.get_points(GetPointsBuilder::new(CONTENT_COLLECTION_NAME, vec![id.clone()]).with_vectors(true).with_payload(true)).await {
        content_point = res.result.into_iter().next();
    }

    if let Ok(res) = client.get_points(GetPointsBuilder::new(METADATA_COLLECTION_NAME, vec![id.clone()]).with_vectors(true).with_payload(true)).await {
        metadata_point = res.result.into_iter().next();
    }

    let existing_hash = content_point
        .as_ref()
        .and_then(|p| p.payload.get("contentHash"))
        .and_then(|v| match &v.kind {
            Some(qdrant_client::qdrant::value::Kind::StringValue(s)) => Some(s.clone()),
            _ => None,
        });

    let content_has_vector = content_point
        .as_ref()
        .and_then(|p| p.vectors.as_ref())
        .is_some(); // We assume it's valid if it exists.

    let metadata_has_vector = metadata_point
        .as_ref()
        .and_then(|p| p.vectors.as_ref())
        .is_some();

    let hash_matches = existing_hash.as_deref() == Some(args.content_hash.as_str());
    let mut reusable_content_vector = hash_matches && content_has_vector;

    if !reusable_content_vector {
        if let Some(existing_vector) = find_content_vector_by_hash(&client, &args.source_id, &args.content_hash).await? {
            upsert_content_vector_for_path(
                &client,
                &args.source_id,
                &args.path,
                &args.content_hash,
                &existing_vector,
            )
            .await?;
            tracing::info!(
                source_id = %args.source_id,
                path = %args.path,
                content_hash_prefix = %hash_prefix(&args.content_hash),
                "embedding dedupe hit: reused existing content vector"
            );
            reusable_content_vector = true;
        } else {
            tracing::debug!(
                source_id = %args.source_id,
                path = %args.path,
                content_hash_prefix = %hash_prefix(&args.content_hash),
                "embedding dedupe miss: no reusable content vector found"
            );
        }
    }
    
    let should_embed_content = !reusable_content_vector;
    let should_embed_metadata = !(hash_matches && metadata_has_vector);
    
    Ok(UpsertMetadataResult {
        should_embed_content,
        should_embed_metadata,
    })
}

pub async fn upsert_embedding(app: &AppHandle, state: &QdrantState, args: UpsertEmbeddingArgs) -> Result<(), String> {
    if args.embedding.len() != VECTOR_DIM {
        return Err(format!(
            "Embedding length {} does not match expected dimensions {}.",
            args.embedding.len(),
            VECTOR_DIM
        ));
    }

    let client = instance(app, state).await?;
    let id = point_id(&args.source_id, &args.path);
    let payload = file_payload(&args.source_id, &args.path, &args.content_hash);
    
    let point = PointStruct::new(id, args.embedding, payload);

    client
        .upsert_points(UpsertPointsBuilder::new(CONTENT_COLLECTION_NAME, vec![point]).wait(true))
        .await
        .map_err(|e| format!("qdrant upsert request failed: {e}"))?;

    Ok(())
}

pub async fn upsert_metadata_embedding(
    app: &AppHandle,
    state: &QdrantState,
    args: UpsertMetadataEmbeddingArgs,
) -> Result<(), String> {
    if args.metadata_embedding.len() != VECTOR_DIM {
        return Err(format!(
            "Metadata embedding length {} does not match expected dimensions {}.",
            args.metadata_embedding.len(),
            VECTOR_DIM
        ));
    }
    
    let client = instance(app, state).await?;
    let id = point_id(&args.source_id, &args.path);
    let payload = file_payload(&args.source_id, &args.path, &args.content_hash);

    let point = PointStruct::new(id, args.metadata_embedding, payload);

    client
        .upsert_points(UpsertPointsBuilder::new(METADATA_COLLECTION_NAME, vec![point]).wait(true))
        .await
        .map_err(|e| format!("qdrant metadata upsert request failed: {e}"))?;

    Ok(())
}

pub async fn semantic_search(app: &AppHandle, state: &QdrantState, args: SemanticSearchArgs) -> Result<Vec<SemanticSearchHit>, String> {
    if args.query_vector.len() != VECTOR_DIM {
        return Err(format!(
            "Query vector length {} does not match expected dimensions {}.",
            args.query_vector.len(),
            VECTOR_DIM
        ));
    }
    
    let limit = args.limit.unwrap_or(16).clamp(1, 256);
    let client = instance(app, state).await?;

    let channel = args.channel.unwrap_or(SemanticSearchChannel::Content);
    let collection = match channel {
        SemanticSearchChannel::Content => CONTENT_COLLECTION_NAME,
        SemanticSearchChannel::Metadata => METADATA_COLLECTION_NAME,
    };

    let filter = Filter::must([
        Condition::matches("sourceId", args.source_id),
    ]);

    let search_points = SearchPointsBuilder::new(collection, args.query_vector, limit as u64)
        .with_payload(true)
        .filter(filter)
        .build();

    let res = client
        .search_points(search_points)
        .await
        .map_err(|e| format!("qdrant query request failed: {e}"))?;

    let mut out = Vec::new();
    for p in res.result {
        let path = p.payload.get("path").and_then(|v| match &v.kind {
            Some(qdrant_client::qdrant::value::Kind::StringValue(s)) => Some(s.clone()),
            _ => None,
        });
        let content_hash = p.payload.get("contentHash").and_then(|v| match &v.kind {
            Some(qdrant_client::qdrant::value::Kind::StringValue(s)) => Some(s.clone()),
            _ => None,
        });

        if let (Some(path), Some(content_hash)) = (path, content_hash) {
            out.push(SemanticSearchHit {
                score: p.score,
                file: SemanticSearchFile { path, content_hash },
            });
        }
    }
    Ok(out)
}

pub async fn count_points(app: &AppHandle, state: &QdrantState, args: CountPointsArgs) -> Result<CountPointsResult, String> {
    let client = instance(app, state).await?;

    let filter = Filter::must([
        Condition::matches("sourceId", args.source_id),
    ]);

    let res = client
        .count(
            CountPointsBuilder::new(CONTENT_COLLECTION_NAME)
                .filter(filter)
                .exact(true)
        )
        .await
        .map_err(|e| format!("qdrant count request failed: {e}"))?;

    Ok(CountPointsResult { count: res.result.unwrap_or_default().count })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QdrantStatus {
    pub base_url: String,
}

pub async fn status(app: &AppHandle, state: &QdrantState) -> Result<QdrantStatus, String> {
    let trimmed = if let Some(url) = configured_qdrant_url() {
        url
    } else {
        ensure_runtime_base_url(app, state).await?
    };

    if let Some(at) = *state.last_failed_at.lock().await {
        if at.elapsed() < CONNECT_COOLDOWN {
            let msg = state
                .last_error
                .lock()
                .await
                .clone()
                .unwrap_or_else(|| "Qdrant is not reachable (cooldown active).".to_string());
            return Err(msg);
        }
    }

    let client = build_qdrant_client(&trimmed, 700, None)?;

    match quick_ready(&client).await {
        Ok(()) => Ok(QdrantStatus { base_url: trimmed }),
        Err(e) => {
            *state.last_failed_at.lock().await = Some(std::time::Instant::now());
            *state.last_error.lock().await = Some(e.clone());
            Err(e)
        }
    }
}

pub async fn ensure_started(app: &AppHandle, state: &QdrantState) -> Result<(), String> {
    let _ = start_qdrant(app, state).await?;
    Ok(())
}

pub async fn shutdown(state: &QdrantState) {
    {
        let mut inner = state.inner.lock().await;
        *inner = None;
    }
    let mut runtime = state.runtime.lock().await;
    runtime.base_url = None;
    if let Some(mut child) = runtime.child.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteAllPointsArgs {
    pub source_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeletePointsForPathsArgs {
    pub source_id: String,
    pub paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeletePointsForPathsResult {
    pub deleted_count: u64,
}

/// Lists indexed file paths under `include_path` by scanning Qdrant payloads (no disk hashing).
pub async fn paths_under_include_root(
    app: &AppHandle,
    state: &QdrantState,
    source_id: &str,
    include_path: &str,
) -> Result<Vec<String>, String> {
    let client = instance(app, state).await?;
    let root = Path::new(include_path);
    let filter = Filter::must([Condition::matches("sourceId", source_id.to_string())]);
    let mut paths: Vec<String> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut offset: Option<PointId> = None;

    loop {
        let mut builder = ScrollPointsBuilder::new(CONTENT_COLLECTION_NAME)
            .filter(filter.clone())
            .limit(256)
            .with_payload(true)
            .with_vectors(false);
        if let Some(ref o) = offset {
            builder = builder.offset(o.clone());
        }

        let res = client
            .scroll(builder)
            .await
            .map_err(|e| format!("qdrant scroll (paths under include) failed: {e}"))?;

        for p in res.result {
            let path_str = p.payload.get("path").and_then(|v| match &v.kind {
                Some(qdrant_client::qdrant::value::Kind::StringValue(s)) => Some(s.clone()),
                _ => None,
            });
            if let Some(path_str) = path_str {
                let file_path = Path::new(&path_str);
                if crate::is_under_dir(file_path, root) && seen.insert(path_str.clone()) {
                    paths.push(path_str);
                }
            }
        }

        offset = res.next_page_offset;
        if offset.is_none() {
            break;
        }
    }

    Ok(paths)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeletePointsForIncludePathArgs {
    pub source_id: String,
    pub include_path: String,
}

pub async fn delete_all_points(app: &AppHandle, state: &QdrantState, args: DeleteAllPointsArgs) -> Result<(), String> {
    let client = instance(app, state).await?;

    let filter = Filter::must([
        Condition::matches("sourceId", args.source_id),
    ]);

    for collection in [CONTENT_COLLECTION_NAME, METADATA_COLLECTION_NAME] {
        client
            .delete_points(
                DeletePointsBuilder::new(collection)
                    .points(filter.clone())
                    .wait(true),
            )
            .await
            .map_err(|e| format!("qdrant delete request failed: {e}"))?;
    }
    Ok(())
}

pub async fn delete_points_for_paths(
    app: &AppHandle,
    state: &QdrantState,
    args: DeletePointsForPathsArgs,
) -> Result<DeletePointsForPathsResult, String> {
    let client = instance(app, state).await?;

    let mut unique_paths = std::collections::HashSet::new();
    let mut ids: Vec<PointId> = Vec::new();
    for path in args.paths {
        if !unique_paths.insert(path.clone()) {
            continue;
        }
        ids.push(point_id(&args.source_id, &path));
    }

    if ids.is_empty() {
        return Ok(DeletePointsForPathsResult { deleted_count: 0 });
    }

    const DELETE_CHUNK_SIZE: usize = 512;
    let mut deleted_count: u64 = 0;

    for chunk in ids.chunks(DELETE_CHUNK_SIZE) {
        for collection in [CONTENT_COLLECTION_NAME, METADATA_COLLECTION_NAME] {
            client
                .delete_points(
                    DeletePointsBuilder::new(collection)
                        .points(chunk.to_vec())
                        .wait(true),
                )
                .await
                .map_err(|e| format!("qdrant delete-by-path request failed: {e}"))?;
        }
        deleted_count = deleted_count.saturating_add(chunk.len() as u64);
    }
    
    Ok(DeletePointsForPathsResult { deleted_count })
}
