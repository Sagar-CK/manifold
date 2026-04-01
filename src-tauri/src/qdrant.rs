use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::AppHandle;
use tokio::sync::Mutex;

const CONTENT_COLLECTION_NAME: &str = "manifold_files_content_v2";
const METADATA_COLLECTION_NAME: &str = "manifold_files_metadata_v2";
const VECTOR_DIM: usize = 3072;
const CONNECT_COOLDOWN: Duration = Duration::from_secs(15);

// Stable app-specific UUID namespace (generated once).
const POINT_ID_NAMESPACE: uuid::Uuid = uuid::uuid!("7c3a7e71-3cdd-4ad2-8a4a-596d4d48226e");

#[derive(Debug)]
pub struct QdrantState {
    inner: Mutex<Option<QdrantInstance>>,
    last_failed_at: Mutex<Option<std::time::Instant>>,
    last_error: Mutex<Option<String>>,
}

impl Default for QdrantState {
    fn default() -> Self {
        Self {
            inner: Mutex::new(None),
            last_failed_at: Mutex::new(None),
            last_error: Mutex::new(None),
        }
    }
}

#[derive(Debug)]
struct QdrantInstance {
    base_url: String,
    http: reqwest::Client,
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

fn point_id(source_id: &str, path: &str) -> uuid::Uuid {
    uuid::Uuid::new_v5(&POINT_ID_NAMESPACE, format!("{source_id}:{path}").as_bytes())
}

async fn quick_http_ready(http: &reqwest::Client, base: &str) -> Result<(), String> {
    // Single fast probe used by qdrant_status to avoid UI lag.
    http.get(base)
        .send()
        .await
        .map_err(|e| format!("Qdrant not reachable at {base}: {e}"))?
        .error_for_status()
        .map(|_| ())
        .map_err(|e| format!("Qdrant not ready at {base}: {e}"))
}

async fn ensure_collection(http: &reqwest::Client, base: &str, collection_name: &str) -> Result<(), String> {
    #[derive(Debug, Serialize)]
    struct CreateCollectionBody {
        vectors: Vectors,
    }
    #[derive(Debug, Serialize)]
    struct Vectors {
        size: usize,
        distance: &'static str,
    }

    fn extract_collection_vector_size(v: &serde_json::Value) -> Option<usize> {
        let vectors = v
            .get("result")?
            .get("config")?
            .get("params")?
            .get("vectors")?;
        if let Some(size) = vectors.get("size").and_then(|s| s.as_u64()) {
            return usize::try_from(size).ok();
        }
        if let Some(obj) = vectors.as_object() {
            for vv in obj.values() {
                if let Some(size) = vv.get("size").and_then(|s| s.as_u64()) {
                    return usize::try_from(size).ok();
                }
            }
        }
        None
    }

    let url = format!("{base}/collections/{collection_name}");

    let get_res = http
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("ensure_collection preflight request failed: {e}"))?;
    let get_status = get_res.status();

    if get_status.is_success() {
        let json: serde_json::Value = get_res
            .json()
            .await
            .map_err(|e| format!("Failed to parse collection config JSON: {e}"))?;
        if let Some(existing_size) = extract_collection_vector_size(&json) {
            if existing_size == VECTOR_DIM {
                return Ok(());
            }
            tracing::warn!(
                collection = collection_name,
                existing_size,
                expected_size = VECTOR_DIM,
                "qdrant collection has wrong vector size; recreating"
            );
            let del_res = http
                .delete(&url)
                .send()
                .await
                .map_err(|e| format!("Failed to delete mismatched collection: {e}"))?;
            let del_status = del_res.status();
            if !del_status.is_success() {
                let text = del_res.text().await.unwrap_or_default();
                return Err(format!(
                    "Failed to delete mismatched collection: HTTP {}: {text}",
                    del_status
                ));
            }
        }
    } else if get_status.as_u16() != 404 {
        let text = get_res.text().await.unwrap_or_default();
        return Err(format!(
            "Failed to inspect Qdrant collection: HTTP {}: {text}",
            get_status
        ));
    }

    let body = CreateCollectionBody {
        vectors: Vectors {
            size: VECTOR_DIM,
            distance: "Cosine",
        },
    };
    let create_res = http
        .put(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("ensure_collection create request failed: {e}"))?;
    let create_status = create_res.status();
    if create_status.is_success() {
        return Ok(());
    }
    let text = create_res.text().await.unwrap_or_default();
    Err(format!(
        "Failed to ensure Qdrant collection: HTTP {}: {text}",
        create_status
    ))
}

async fn start_qdrant(_app: &AppHandle) -> Result<QdrantInstance, String> {
    let url = std::env::var("MANIFOLD_QDRANT_URL").unwrap_or_default();
    let trimmed = url.trim().to_string();
    if trimmed.is_empty() {
        return Err(
            "Missing MANIFOLD_QDRANT_URL. Start Qdrant with Docker (./scripts/qdrant-dev.sh up) and set MANIFOLD_QDRANT_URL=http://127.0.0.1:6333".to_string(),
        );
    }
    // Keep this fast. The UI may call into Qdrant during embedding/search and we should
    // fail quickly when the local Qdrant instance isn't running.
    let http = reqwest::Client::builder()
        .connect_timeout(Duration::from_millis(350))
        .timeout(Duration::from_millis(1200))
        .build()
        .map_err(|e| e.to_string())?;
    // Single probe first: if Qdrant is down, don't spend seconds retrying.
    quick_http_ready(&http, &trimmed).await?;
    // If Qdrant is starting up, collection creation may still fail once; keep a tiny
    // retry loop here without impacting the UI too much.
    ensure_collection(&http, &trimmed, CONTENT_COLLECTION_NAME).await?;
    ensure_collection(&http, &trimmed, METADATA_COLLECTION_NAME).await?;
    Ok(QdrantInstance { base_url: trimmed, http })
}

async fn instance(app: &AppHandle, state: &QdrantState) -> Result<(reqwest::Client, String), String> {
    // Prevent repeated connection attempts from lagging the UI when Qdrant is down.
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
        match start_qdrant(app).await {
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
    Ok((inst.http.clone(), inst.base_url.clone()))
}

fn truncate_for_log(s: &str, max: usize) -> String {
    if s.len() <= max {
        return s.to_string();
    }
    format!("{}…(truncated)", &s[..max])
}

fn file_payload(source_id: &str, path: &str, content_hash: &str) -> serde_json::Value {
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
    serde_json::json!({
        "sourceId": source_id,
        "path": path,
        "contentHash": content_hash,
        "fileName": file_name,
        "extension": extension,
    })
}

async fn find_content_vector_by_hash(
    http: &reqwest::Client,
    base: &str,
    source_id: &str,
    content_hash: &str,
) -> Result<Option<Vec<f32>>, String> {
    #[derive(Debug, Serialize)]
    struct ScrollBody {
        limit: u32,
        with_vector: bool,
        with_payload: bool,
        filter: Filter,
    }
    #[derive(Debug, Serialize)]
    struct Filter {
        must: Vec<Condition>,
    }
    #[derive(Debug, Serialize)]
    struct Condition {
        key: &'static str,
        r#match: MatchValue,
    }
    #[derive(Debug, Serialize)]
    struct MatchValue {
        value: String,
    }
    #[derive(Debug, Deserialize)]
    struct ScrollResponse {
        result: ScrollResult,
    }
    #[derive(Debug, Deserialize)]
    struct ScrollResult {
        points: Vec<ScrollPoint>,
    }
    #[derive(Debug, Deserialize)]
    struct ScrollPoint {
        vector: Option<serde_json::Value>,
    }

    let body = ScrollBody {
        limit: 1,
        with_vector: true,
        with_payload: false,
        filter: Filter {
            must: vec![
                Condition {
                    key: "sourceId",
                    r#match: MatchValue {
                        value: source_id.to_string(),
                    },
                },
                Condition {
                    key: "contentHash",
                    r#match: MatchValue {
                        value: content_hash.to_string(),
                    },
                },
            ],
        },
    };
    let url = format!("{base}/collections/{CONTENT_COLLECTION_NAME}/points/scroll");
    let res = http
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("qdrant scroll request failed: {e}"))?;
    let status = res.status();
    if !status.is_success() {
        let text = res.text().await.unwrap_or_default();
        return Err(format!("Failed to scroll points: HTTP {}: {text}", status));
    }
    let json: ScrollResponse = res
        .json()
        .await
        .map_err(|e| format!("Failed to decode scroll response: {e}"))?;
    let vector_value = json.result.points.into_iter().find_map(|p| p.vector);
    let Some(vector_value) = vector_value else {
        return Ok(None);
    };
    if let Some(arr) = vector_value.as_array() {
        let values: Vec<f32> = arr
            .iter()
            .filter_map(|v| v.as_f64())
            .map(|x| x as f32)
            .collect();
        if values.len() == VECTOR_DIM {
            return Ok(Some(values));
        }
        return Ok(None);
    }
    if let Some(obj) = vector_value.as_object() {
        for v in obj.values() {
            if let Some(arr) = v.as_array() {
                let values: Vec<f32> = arr
                    .iter()
                    .filter_map(|x| x.as_f64())
                    .map(|x| x as f32)
                    .collect();
                if values.len() == VECTOR_DIM {
                    return Ok(Some(values));
                }
            }
        }
    }
    Ok(None)
}

async fn upsert_content_vector_for_path(
    http: &reqwest::Client,
    base: &str,
    source_id: &str,
    path: &str,
    content_hash: &str,
    embedding: &[f32],
) -> Result<(), String> {
    #[derive(Debug, Serialize)]
    struct UpsertBody<'a> {
        points: Vec<Point<'a>>,
    }
    #[derive(Debug, Serialize)]
    struct Point<'a> {
        id: String,
        vector: &'a [f32],
        payload: serde_json::Value,
    }

    let id = point_id(source_id, path);
    let body = UpsertBody {
        points: vec![Point {
            id: id.to_string(),
            vector: embedding,
            payload: file_payload(source_id, path, content_hash),
        }],
    };
    let url = format!("{base}/collections/{CONTENT_COLLECTION_NAME}/points?wait=true");
    let res = http
        .put(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("qdrant content copy upsert request failed: {e}"))?;
    let status = res.status();
    if !status.is_success() {
        let text = res.text().await.unwrap_or_default();
        return Err(format!("Failed to upsert copied content vector: HTTP {}: {text}", status));
    }
    Ok(())
}

fn hash_prefix(value: &str) -> &str {
    let n = std::cmp::min(12, value.len());
    &value[..n]
}

pub async fn upsert_metadata(app: &AppHandle, state: &QdrantState, args: UpsertMetadataArgs) -> Result<UpsertMetadataResult, String> {
    let (http, base) = instance(app, state).await?;

    #[derive(Debug, Deserialize)]
    struct GetPointResponse {
        result: Option<GetPointResult>,
    }
    #[derive(Debug, Deserialize)]
    struct GetPointResult {
        payload: Option<serde_json::Value>,
        #[serde(default)]
        vector: Option<Vec<f32>>,
    }

    // We request the vector because an existing point may have metadata but no embedding vector
    // (e.g. previous partial upsert / failed embedding write). In that case we must re-embed.
    let id = point_id(&args.source_id, &args.path);
    async fn read_point(
        http: &reqwest::Client,
        base: &str,
        collection_name: &str,
        id: &uuid::Uuid,
    ) -> Result<Option<GetPointResult>, String> {
        let url = format!(
            "{base}/collections/{collection_name}/points/{id}?with_vector=true&with_payload=true"
        );
        let res = http
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("qdrant get point request failed: {e}"))?;
        let status = res.status();
        if status.as_u16() == 404 {
            return Ok(None);
        }
        if !status.is_success() {
            let text = res.text().await.unwrap_or_default();
            return Err(format!("Failed to read existing point: HTTP {}: {text}", status));
        }
        let json: GetPointResponse = res.json().await.map_err(|e| e.to_string())?;
        Ok(json.result)
    }

    let content_point = read_point(&http, &base, CONTENT_COLLECTION_NAME, &id).await?;
    let metadata_point = read_point(&http, &base, METADATA_COLLECTION_NAME, &id).await?;

    let existing_hash = content_point
        .as_ref()
        .and_then(|r| r.payload.clone())
        .and_then(|p| p.get("contentHash").cloned())
        .and_then(|v| v.as_str().map(|s| s.to_string()));
    let content_has_vector = content_point
        .as_ref()
        .and_then(|r| r.vector.as_ref())
        .is_some_and(|v| v.len() == VECTOR_DIM);
    let metadata_has_vector = metadata_point
        .as_ref()
        .and_then(|r| r.vector.as_ref())
        .is_some_and(|v| v.len() == VECTOR_DIM);
    let hash_matches = existing_hash.as_deref() == Some(args.content_hash.as_str());
    let mut reusable_content_vector = hash_matches && content_has_vector;
    if !reusable_content_vector {
        if let Some(existing_vector) = find_content_vector_by_hash(&http, &base, &args.source_id, &args.content_hash).await? {
            upsert_content_vector_for_path(
                &http,
                &base,
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

    let (http, base) = instance(app, state).await?;
    let id = point_id(&args.source_id, &args.path);

    #[derive(Debug, Serialize)]
    struct UpsertBody<'a> {
        points: Vec<Point<'a>>,
    }
    #[derive(Debug, Serialize)]
    struct Point<'a> {
        id: String,
        vector: &'a [f32],
        payload: serde_json::Value,
    }

    let payload = file_payload(&args.source_id, &args.path, &args.content_hash);
    let body = UpsertBody {
        points: vec![Point {
            id: id.to_string(),
            vector: &args.embedding,
            payload,
        }],
    };

    let url = format!("{base}/collections/{CONTENT_COLLECTION_NAME}/points?wait=true");
    let res = http
        .put(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("qdrant upsert request failed: {e}"))?;
    let status = res.status();
    if !status.is_success() {
        let text = res.text().await.unwrap_or_default();
        return Err(format!("Failed to upsert point: HTTP {}: {text}", status));
    }
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
    let (http, base) = instance(app, state).await?;
    let id = point_id(&args.source_id, &args.path);
    let file_name = std::path::Path::new(&args.path)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or_default()
        .to_string();
    let extension = std::path::Path::new(&args.path)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let payload = serde_json::json!({
        "sourceId": args.source_id,
        "path": args.path,
        "contentHash": args.content_hash,
        "fileName": file_name,
        "extension": extension,
    });
    let body = serde_json::json!({
        "points": [{
            "id": id.to_string(),
            "vector": args.metadata_embedding,
            "payload": payload
        }]
    });
    let url = format!("{base}/collections/{METADATA_COLLECTION_NAME}/points?wait=true");
    let res = http
        .put(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("qdrant metadata upsert request failed: {e}"))?;
    let status = res.status();
    if !status.is_success() {
        let text = res.text().await.unwrap_or_default();
        return Err(format!("Failed to upsert metadata point: HTTP {}: {text}", status));
    }
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
    let (http, base) = instance(app, state).await?;

    #[derive(Debug, Serialize)]
    struct QueryBody<'a> {
        query: &'a [f32],
        limit: u32,
        with_payload: bool,
        filter: Filter,
    }
    #[derive(Debug, Serialize)]
    struct Filter {
        must: Vec<Condition>,
    }
    #[derive(Debug, Serialize)]
    struct Condition {
        key: &'static str,
        r#match: MatchValue,
    }
    #[derive(Debug, Serialize)]
    struct MatchValue {
        value: String,
    }

    #[derive(Debug, Deserialize)]
    struct QueryResponse {
        result: QueryResult,
    }
    #[derive(Debug, Deserialize)]
    #[serde(untagged)]
    enum QueryResult {
        // Some Qdrant versions return: { "result": { "points": [...] } }
        Points { points: Vec<ScoredPoint> },
        // Others return: { "result": [ ... ] }
        Flat(Vec<ScoredPoint>),
    }
    #[derive(Debug, Deserialize)]
    struct ScoredPoint {
        score: f32,
        payload: Option<serde_json::Value>,
    }

    let body = QueryBody {
        query: &args.query_vector,
        limit,
        with_payload: true,
        filter: Filter {
            must: vec![Condition {
                key: "sourceId",
                r#match: MatchValue {
                    value: args.source_id,
                },
            }],
        },
    };

    let channel = args.channel.unwrap_or(SemanticSearchChannel::Content);
    let collection = match channel {
        SemanticSearchChannel::Content => CONTENT_COLLECTION_NAME,
        SemanticSearchChannel::Metadata => METADATA_COLLECTION_NAME,
    };
    let url = format!("{base}/collections/{collection}/points/query");
    let res = http
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("qdrant query request failed: {e}"))?;
    let status = res.status();
    if !status.is_success() {
        let text = res.text().await.unwrap_or_default();
        return Err(format!("Failed to query points: HTTP {}: {text}", status));
    }
    // If decoding fails, include a snippet of the response body (Qdrant sometimes returns a
    // different schema or a text error that serde can't decode).
    let text = res.text().await.map_err(|e| format!("Failed to read response body: {e}"))?;
    let json: QueryResponse = serde_json::from_str(&text).map_err(|e| {
        let snippet = truncate_for_log(&text, 1400);
        format!("Failed to decode Qdrant query response: {e}. Body: {snippet}")
    })?;

    let points: Vec<ScoredPoint> = match json.result {
        QueryResult::Points { points } => points,
        QueryResult::Flat(points) => points,
    };

    let mut out = Vec::new();
    for p in points {
        let path = p
            .payload
            .as_ref()
            .and_then(|v| v.get("path"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let content_hash = p
            .payload
            .as_ref()
            .and_then(|v| v.get("contentHash"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
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
    let (http, base) = instance(app, state).await?;

    #[derive(Debug, Serialize)]
    struct CountBody {
        exact: bool,
        filter: Filter,
    }
    #[derive(Debug, Serialize)]
    struct Filter {
        must: Vec<Condition>,
    }
    #[derive(Debug, Serialize)]
    struct Condition {
        key: &'static str,
        r#match: MatchValue,
    }
    #[derive(Debug, Serialize)]
    struct MatchValue {
        value: String,
    }

    #[derive(Debug, Deserialize)]
    struct CountResponse {
        result: CountResult,
    }
    #[derive(Debug, Deserialize)]
    struct CountResult {
        count: u64,
    }

    let body = CountBody {
        exact: true,
        filter: Filter {
            must: vec![Condition {
                key: "sourceId",
                r#match: MatchValue {
                    value: args.source_id,
                },
            }],
        },
    };

    let url = format!("{base}/collections/{CONTENT_COLLECTION_NAME}/points/count");
    let res = http
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("qdrant count request failed: {e}"))?;
    let status = res.status();
    if !status.is_success() {
        let text = res.text().await.unwrap_or_default();
        return Err(format!("Failed to count points: HTTP {}: {text}", status));
    }
    let text = res.text().await.map_err(|e| format!("Failed to read response body: {e}"))?;
    let json: CountResponse = serde_json::from_str(&text).map_err(|e| {
        let snippet = truncate_for_log(&text, 1400);
        format!("Failed to decode Qdrant count response: {e}. Body: {snippet}")
    })?;
    Ok(CountPointsResult { count: json.result.count })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QdrantStatus {
    pub base_url: String,
}

pub async fn status(_app: &AppHandle, state: &QdrantState) -> Result<QdrantStatus, String> {
    // Status is called by the UI on startup; it must be fast and must not block with long retries.
    let url = std::env::var("MANIFOLD_QDRANT_URL").unwrap_or_default();
    let trimmed = url.trim().to_string();
    if trimmed.is_empty() {
        return Err(
            "Missing MANIFOLD_QDRANT_URL. Start Qdrant with Docker (./scripts/qdrant-dev.sh up) and set MANIFOLD_QDRANT_URL=http://127.0.0.1:6333".to_string(),
        );
    }

    // Respect cooldown to avoid repeated laggy probes.
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

    let http = reqwest::Client::builder()
        .timeout(Duration::from_millis(700))
        .build()
        .map_err(|e| e.to_string())?;
    match quick_http_ready(&http, &trimmed).await {
        Ok(()) => Ok(QdrantStatus { base_url: trimmed }),
        Err(e) => {
            *state.last_failed_at.lock().await = Some(std::time::Instant::now());
            *state.last_error.lock().await = Some(e.clone());
            Err(e)
        }
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

pub async fn delete_all_points(app: &AppHandle, state: &QdrantState, args: DeleteAllPointsArgs) -> Result<(), String> {
    let (http, base) = instance(app, state).await?;

    #[derive(Debug, Serialize)]
    struct DeleteBody {
        filter: Filter,
    }
    #[derive(Debug, Serialize)]
    struct Filter {
        must: Vec<Condition>,
    }
    #[derive(Debug, Serialize)]
    struct Condition {
        key: &'static str,
        r#match: MatchValue,
    }
    #[derive(Debug, Serialize)]
    struct MatchValue {
        value: String,
    }

    let body = DeleteBody {
        filter: Filter {
            must: vec![Condition {
                key: "sourceId",
                r#match: MatchValue {
                    value: args.source_id.clone(),
                },
            }],
        },
    };
    for collection in [CONTENT_COLLECTION_NAME, METADATA_COLLECTION_NAME] {
        let url = format!("{base}/collections/{collection}/points/delete?wait=true");
        let res = http
            .post(&url)
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("qdrant delete request failed: {e}"))?;
        let status = res.status();
        if !status.is_success() {
            let text = res.text().await.unwrap_or_default();
            return Err(format!("Failed to delete points: HTTP {}: {text}", status));
        }
    }
    Ok(())
}

pub async fn delete_points_for_paths(
    app: &AppHandle,
    state: &QdrantState,
    args: DeletePointsForPathsArgs,
) -> Result<DeletePointsForPathsResult, String> {
    let (http, base) = instance(app, state).await?;

    #[derive(Debug, Serialize)]
    struct DeleteBody {
        points: Vec<String>,
    }

    let mut unique_paths = std::collections::HashSet::new();
    let mut ids: Vec<String> = Vec::new();
    for path in args.paths {
        if !unique_paths.insert(path.clone()) {
            continue;
        }
        ids.push(point_id(&args.source_id, &path).to_string());
    }

    if ids.is_empty() {
        return Ok(DeletePointsForPathsResult { deleted_count: 0 });
    }

    const DELETE_CHUNK_SIZE: usize = 512;
    let mut deleted_count: u64 = 0;

    for chunk in ids.chunks(DELETE_CHUNK_SIZE) {
        let body = DeleteBody {
            points: chunk.to_vec(),
        };
        for collection in [CONTENT_COLLECTION_NAME, METADATA_COLLECTION_NAME] {
            let url = format!("{base}/collections/{collection}/points/delete?wait=true");
            let res = http
                .post(&url)
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("qdrant delete-by-path request failed: {e}"))?;
            let status = res.status();
            if !status.is_success() {
                let text = res.text().await.unwrap_or_default();
                return Err(format!(
                    "Failed to delete points for selected files: HTTP {}: {text}",
                    status
                ));
            }
        }
        deleted_count = deleted_count.saturating_add(chunk.len() as u64);
    }
    Ok(DeletePointsForPathsResult { deleted_count })
}

