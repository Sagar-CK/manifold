use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::AppHandle;
use tokio::sync::Mutex;
use tracing::{debug, info, warn};

const COLLECTION_NAME: &str = "manifold_files_v1";
const VECTOR_DIM: usize = 768;
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
    pub should_embed: bool,
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
pub struct SemanticSearchArgs {
    pub source_id: String,
    pub query_vector: Vec<f32>,
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SemanticSearchHit {
    pub score: f32,
    pub file: SemanticSearchFile,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SemanticSearchFile {
    pub path: String,
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

async fn ensure_collection(http: &reqwest::Client, base: &str) -> Result<(), String> {
    #[derive(Debug, Serialize)]
    struct CreateCollectionBody {
        vectors: Vectors,
    }
    #[derive(Debug, Serialize)]
    struct Vectors {
        size: usize,
        distance: &'static str,
    }

    // Create is idempotent-ish: if it exists, Qdrant returns an error. We treat that as ok.
    let url = format!("{base}/collections/{COLLECTION_NAME}");
    let body = CreateCollectionBody {
        vectors: Vectors {
            size: VECTOR_DIM,
            distance: "Cosine",
        },
    };
    let res = http
        .put(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("ensure_collection request failed: {e}"))?;
    let status = res.status();
    if status.is_success() {
        info!(collection = COLLECTION_NAME, vector_dim = VECTOR_DIM, "qdrant collection ensured");
        return Ok(());
    }
    // Already exists / conflict is fine.
    if status.as_u16() == 409 {
        info!(collection = COLLECTION_NAME, "qdrant collection already exists");
        return Ok(());
    }
    let text = res.text().await.unwrap_or_default();
    Err(format!(
        "Failed to ensure Qdrant collection: HTTP {}: {text}",
        status
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
    info!(base_url = %trimmed, "qdrant: connecting");
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
    ensure_collection(&http, &trimmed).await?;
    info!(base_url = %trimmed, "qdrant: ready");
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
                warn!(error = %e, "qdrant: connect failed (entering cooldown)");
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

pub async fn upsert_metadata(app: &AppHandle, state: &QdrantState, args: UpsertMetadataArgs) -> Result<UpsertMetadataResult, String> {
    let (http, base) = instance(app, state).await?;
    let id = point_id(&args.source_id, &args.path);
    let started = std::time::Instant::now();

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
    let url = format!(
        "{base}/collections/{COLLECTION_NAME}/points/{id}?with_vector=true&with_payload=true"
    );
    debug!(%id, url = %url, "qdrant get point");
    let res = http
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("qdrant get point request failed: {e}"))?;
    let status = res.status();
    if status.as_u16() == 404 {
        info!(
            %id,
            elapsed_ms = started.elapsed().as_millis(),
            "qdrant get point: missing (should_embed=true)"
        );
        return Ok(UpsertMetadataResult { should_embed: true });
    }
    if !status.is_success() {
        let text = res.text().await.unwrap_or_default();
        warn!(%id, http_status = %status, body = %text, "qdrant get point failed");
        return Err(format!(
            "Failed to read existing point: HTTP {}: {text}",
            status
        ));
    }
    let json: GetPointResponse = res.json().await.map_err(|e| e.to_string())?;
    let existing_hash = json
        .result
        .as_ref()
        .and_then(|r| r.payload.clone())
        .and_then(|p| p.get("contentHash").cloned())
        .and_then(|v| v.as_str().map(|s| s.to_string()));

    let has_vector = json
        .result
        .as_ref()
        .and_then(|r| r.vector.as_ref())
        .is_some_and(|v| v.len() == VECTOR_DIM);

    let hash_matches = existing_hash.as_deref() == Some(args.content_hash.as_str());
    let should_embed = !(hash_matches && has_vector);
    info!(
        %id,
        should_embed,
        hash_matches,
        has_vector,
        elapsed_ms = started.elapsed().as_millis(),
        "qdrant get point: ok"
    );
    Ok(UpsertMetadataResult { should_embed })
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
    let started = std::time::Instant::now();

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

    let payload = serde_json::json!({
        "sourceId": args.source_id,
        "path": args.path,
        "contentHash": args.content_hash,
    });
    let body = UpsertBody {
        points: vec![Point {
            id: id.to_string(),
            vector: &args.embedding,
            payload,
        }],
    };

    let url = format!("{base}/collections/{COLLECTION_NAME}/points?wait=true");
    debug!(%id, url = %url, "qdrant upsert point");
    let res = http
        .put(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("qdrant upsert request failed: {e}"))?;
    let status = res.status();
    if !status.is_success() {
        let text = res.text().await.unwrap_or_default();
        warn!(%id, http_status = %status, body = %text, "qdrant upsert failed");
        return Err(format!("Failed to upsert point: HTTP {}: {text}", status));
    }
    info!(%id, elapsed_ms = started.elapsed().as_millis(), "qdrant upsert ok");
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
    let started = std::time::Instant::now();

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

    let url = format!("{base}/collections/{COLLECTION_NAME}/points/query");
    debug!(url = %url, limit, source_id = %body.filter.must[0].r#match.value, "qdrant query");
    let res = http
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("qdrant query request failed: {e}"))?;
    let status = res.status();
    if !status.is_success() {
        let text = res.text().await.unwrap_or_default();
        warn!(http_status = %status, body = %text, "qdrant query failed");
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
        if let Some(path) = path {
            out.push(SemanticSearchHit {
                score: p.score,
                file: SemanticSearchFile { path },
            });
        }
    }
    info!(
        results = out.len(),
        elapsed_ms = started.elapsed().as_millis(),
        "qdrant query ok"
    );
    Ok(out)
}

pub async fn count_points(app: &AppHandle, state: &QdrantState, args: CountPointsArgs) -> Result<CountPointsResult, String> {
    let (http, base) = instance(app, state).await?;
    let started = std::time::Instant::now();

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

    let url = format!("{base}/collections/{COLLECTION_NAME}/points/count");
    debug!(url = %url, "qdrant count points");
    let res = http
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("qdrant count request failed: {e}"))?;
    let status = res.status();
    if !status.is_success() {
        let text = res.text().await.unwrap_or_default();
        warn!(http_status = %status, body = %text, "qdrant count failed");
        return Err(format!("Failed to count points: HTTP {}: {text}", status));
    }
    let text = res.text().await.map_err(|e| format!("Failed to read response body: {e}"))?;
    let json: CountResponse = serde_json::from_str(&text).map_err(|e| {
        let snippet = truncate_for_log(&text, 1400);
        format!("Failed to decode Qdrant count response: {e}. Body: {snippet}")
    })?;
    info!(
        count = json.result.count,
        elapsed_ms = started.elapsed().as_millis(),
        "qdrant count ok"
    );
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
            warn!(error = %e, "qdrant: status probe failed (entering cooldown)");
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
    let started = std::time::Instant::now();

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

    let url = format!("{base}/collections/{COLLECTION_NAME}/points/delete?wait=true");
    debug!(url = %url, source_id = %args.source_id, "qdrant delete points");
    let res = http
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("qdrant delete request failed: {e}"))?;
    let status = res.status();
    if !status.is_success() {
        let text = res.text().await.unwrap_or_default();
        warn!(http_status = %status, body = %text, "qdrant delete failed");
        return Err(format!("Failed to delete points: HTTP {}: {text}", status));
    }
    info!(
        source_id = %args.source_id,
        elapsed_ms = started.elapsed().as_millis(),
        "qdrant delete ok"
    );
    Ok(())
}

pub async fn delete_points_for_paths(
    app: &AppHandle,
    state: &QdrantState,
    args: DeletePointsForPathsArgs,
) -> Result<DeletePointsForPathsResult, String> {
    let (http, base) = instance(app, state).await?;
    let started = std::time::Instant::now();

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
        let url = format!("{base}/collections/{COLLECTION_NAME}/points/delete?wait=true");
        debug!(
            url = %url,
            source_id = %args.source_id,
            chunk_size = chunk.len(),
            "qdrant delete points by ids"
        );
        let res = http
            .post(&url)
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("qdrant delete-by-path request failed: {e}"))?;
        let status = res.status();
        if !status.is_success() {
            let text = res.text().await.unwrap_or_default();
            warn!(http_status = %status, body = %text, "qdrant delete-by-path failed");
            return Err(format!(
                "Failed to delete points for selected files: HTTP {}: {text}",
                status
            ));
        }
        deleted_count = deleted_count.saturating_add(chunk.len() as u64);
    }

    info!(
        source_id = %args.source_id,
        deleted_count,
        elapsed_ms = started.elapsed().as_millis(),
        "qdrant delete-by-path ok"
    );
    Ok(DeletePointsForPathsResult { deleted_count })
}

