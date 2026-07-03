import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { QdrantClient } from "@qdrant/js-client-rest";
import { app } from "electron";
import { v5 as uuidv5 } from "uuid";
import {
  qdrantBinaryCandidates,
  resolveFirstExisting,
} from "../core/app-paths.js";
import { isUnderDir } from "./text-index.js";

export const CONTENT_COLLECTION_NAME = "content_embeddings";
export const METADATA_COLLECTION_NAME = "metadata_embeddings";
export const VECTOR_DIM = 3072;
export const POINT_ID_NAMESPACE = "7c3a7e71-3cdd-4ad2-8a4a-596d4d48226e";
export const EMBEDDING_QDRANT_UPSERT_BATCH = 24;

const CONNECT_COOLDOWN_MS = 15_000;
const DEV_DOCKER_QDRANT_URL = "http://127.0.0.1:6334";

function trimEnv(key: string): string | undefined {
  const v = process.env[key]?.trim();
  return v && v.length > 0 ? v : undefined;
}

function isUnpackagedDev(): boolean {
  try {
    return !app.isPackaged;
  } catch {
    return Boolean(process.env.VITE_DEV_SERVER_URL?.trim());
  }
}

/** Dev uses Docker Qdrant; packaged apps use bundled binary unless overridden. */
function resolveQdrantEnvUrl(): string | undefined {
  const fromEnv = trimEnv("MANIFOLD_QDRANT_URL");
  if (fromEnv) return fromEnv;
  if (isUnpackagedDev()) return DEV_DOCKER_QDRANT_URL;
  return undefined;
}

function devDockerHint(): string {
  if (!isUnpackagedDev() || trimEnv("MANIFOLD_QDRANT_URL")) return "";
  return " Use the in-app setup flow to start Qdrant with Docker.";
}

export function pointId(sourceId: string, filePath: string): string {
  return uuidv5(`${sourceId}:${filePath}`, POINT_ID_NAMESPACE);
}

export function grpcUrlToRestBase(grpcOrHttpUrl: string): string {
  try {
    const u = new URL(grpcOrHttpUrl);
    const host = u.hostname;
    const port = u.port ? parseInt(u.port, 10) : 80;
    if (port === 6334) return `http://${host}:6333`;
    if (port === 6333) return grpcOrHttpUrl;
    return `http://${host}:6333`;
  } catch {
    return "http://127.0.0.1:6333";
  }
}

function humanizeQdrantConnectionError(url: string, error: string): string {
  try {
    const u = new URL(url);
    const port = u.port ? parseInt(u.port, 10) : 80;
    const host = u.hostname || "127.0.0.1";
    if (port === 6333) {
      return `Qdrant is not accessible at ${url}. Ensure Qdrant REST is running on ${url}. (${error})`;
    }
    if (error.includes("h2") || error.includes("http2")) {
      return `Qdrant is not accessible at ${url}. Use HTTP REST, usually http://${host}:6333. (${error})`;
    }
    return `Qdrant is not accessible at ${url}: ${error}`;
  } catch {
    return `Qdrant is not accessible at ${url}: ${error}`;
  }
}

async function findAvailablePort(start: number): Promise<number> {
  for (let off = 0; off < 32; off++) {
    const port = start + off;
    const ok = await new Promise<boolean>((resolve) => {
      const s = net.createServer();
      s.once("error", () => resolve(false));
      s.listen(port, "127.0.0.1", () => {
        s.close(() => resolve(true));
      });
    });
    if (ok) return port;
  }
  throw new Error(`No free TCP port found near ${start}`);
}

async function quickReady(
  client: QdrantClient,
  restUrl: string,
): Promise<void> {
  try {
    await client.getCollections();
  } catch (e) {
    throw new Error(humanizeQdrantConnectionError(restUrl, String(e)));
  }
}

type RuntimeState = {
  child: ChildProcess | null;
  grpcBaseUrl: string | null;
  restBaseUrl: string | null;
  httpDashboardPort: number | null;
};

const runtime: RuntimeState = {
  child: null,
  grpcBaseUrl: null,
  restBaseUrl: null,
  httpDashboardPort: null,
};

let cachedClient: QdrantClient | null = null;
let clientRestUrl: string | null = null;
let lastFailedAt = 0;
let lastError: string | null = null;

function qdrantBinaryPath(): string {
  const found = resolveFirstExisting(qdrantBinaryCandidates());
  if (!found) {
    throw new Error(
      "Qdrant binary was not found. Run `pnpm setup:binaries` to install qdrant.",
    );
  }
  return found;
}

function buildClient(restUrl: string, timeoutMs = 300): QdrantClient {
  // Optional: only needed when MANIFOLD_QDRANT_URL points at a secured remote instance.
  const apiKey = trimEnv("MANIFOLD_QDRANT_API_KEY");
  return new QdrantClient({
    url: restUrl,
    apiKey: apiKey ?? undefined,
    timeout: timeoutMs,
    checkCompatibility: false,
  });
}

export function getClient(): QdrantClient {
  if (!cachedClient || !clientRestUrl) {
    throw new Error("Qdrant client not initialized; call ensureStarted first.");
  }
  return cachedClient;
}

export function getClientWithTimeout(timeoutMs: number): QdrantClient {
  if (!clientRestUrl) {
    throw new Error("Qdrant client not initialized; call ensureStarted first.");
  }
  return buildClient(clientRestUrl, timeoutMs);
}

export function getGrpcBaseUrl(): string | null {
  return runtime.grpcBaseUrl;
}

export type QdrantStatus = { baseUrl: string };

export async function ensureCollections(client: QdrantClient): Promise<void> {
  for (const name of [CONTENT_COLLECTION_NAME, METADATA_COLLECTION_NAME]) {
    const ex = await client.collectionExists(name);
    if (ex.exists) continue;
    await client.createCollection(name, {
      vectors: { size: VECTOR_DIM, distance: "Cosine" },
    });
  }
}

export type ContentIndexEntry = {
  contentHash?: string;
  sizeBytes?: number;
  mtimeMs?: number;
};

export type SourcePreflightIndex = {
  contentByPath: Map<string, ContentIndexEntry>;
  metadataPaths: Set<string>;
  hashToCanonicalPath: Map<string, string>;
  contentVectorsByHash: Map<string, number[]>;
};

export type UpsertMetadataResult = {
  shouldEmbedContent: boolean;
  shouldEmbedMetadata: boolean;
};

export function decideEmbeddingNeedFromIndex(
  pathStr: string,
  contentHash: string,
  index: SourcePreflightIndex,
): UpsertMetadataResult {
  const entry = index.contentByPath.get(pathStr);
  const storedHash = entry?.contentHash;
  const hashMatches = storedHash === contentHash;
  const contentIndexed = entry !== undefined;
  const metadataHasVector = index.metadataPaths.has(pathStr);
  const reusableContentVector = contentIndexed && hashMatches;
  return {
    shouldEmbedContent: !reusableContentVector,
    shouldEmbedMetadata: !(hashMatches && metadataHasVector),
  };
}

export function reuseHashIfFingerprintMatches(
  pathStr: string,
  diskSizeBytes: number,
  diskMtimeMs: number,
  index: SourcePreflightIndex,
): string | undefined {
  const e = index.contentByPath.get(pathStr);
  if (!e) return undefined;
  if (e.sizeBytes === diskSizeBytes && e.mtimeMs === diskMtimeMs) {
    return e.contentHash;
  }
  return undefined;
}

export function duplicateContentVectorForPath(
  index: SourcePreflightIndex,
  contentHash: string,
  pathStr: string,
): number[] | undefined {
  const canon = index.hashToCanonicalPath.get(contentHash);
  if (!canon || canon === pathStr) return undefined;
  return index.contentVectorsByHash.get(contentHash);
}

function payloadStr(
  payload: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const v = payload?.[key];
  if (typeof v === "string") return v;
  return undefined;
}

function payloadU64(
  payload: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  const v = payload?.[key];
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return undefined;
}

function payloadI64(
  payload: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  return payloadU64(payload, key);
}

function payloadTagIds(payload: Record<string, unknown> | undefined): string[] {
  const v = payload?.tagIds;
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

export function vecFromRecord(v: unknown): number[] | null {
  if (Array.isArray(v)) return v.map(Number);
  if (v && typeof v === "object" && "default" in v) {
    const d = (v as { default?: unknown }).default;
    if (Array.isArray(d)) return d.map(Number);
  }
  return null;
}

export async function loadSourcePreflightIndex(
  client: QdrantClient,
  sourceId: string,
): Promise<SourcePreflightIndex> {
  const mustSource = {
    must: [{ key: "sourceId", match: { value: sourceId } }],
  };

  const contentByPath = new Map<string, ContentIndexEntry>();
  const contentVectorsByHash = new Map<string, number[]>();
  const hashToCanonicalPath = new Map<string, string>();

  let offset: string | number | undefined;
  for (;;) {
    const res = await client.scroll(CONTENT_COLLECTION_NAME, {
      filter: mustSource,
      limit: 256,
      offset,
      with_payload: true,
      with_vector: true,
    });
    for (const p of res.points) {
      const pl = (p.payload ?? {}) as Record<string, unknown>;
      const pathStr = payloadStr(pl, "path");
      if (!pathStr) continue;
      const ch = payloadStr(pl, "contentHash");
      contentByPath.set(pathStr, {
        contentHash: ch,
        sizeBytes: payloadU64(pl, "sizeBytes"),
        mtimeMs: payloadI64(pl, "mtimeMs"),
      });
      const vec = vecFromRecord(p.vector);
      if (ch && vec && vec.length === VECTOR_DIM) {
        if (!contentVectorsByHash.has(ch)) contentVectorsByHash.set(ch, vec);
        if (!hashToCanonicalPath.has(ch)) hashToCanonicalPath.set(ch, pathStr);
      }
    }
    const nextOff = res.next_page_offset;
    if (nextOff === null || nextOff === undefined) break;
    offset = nextOff as string | number;
  }

  const metadataPaths = new Set<string>();
  offset = undefined;
  for (;;) {
    const res = await client.scroll(METADATA_COLLECTION_NAME, {
      filter: mustSource,
      limit: 256,
      offset,
      with_payload: true,
      with_vector: false,
    });
    for (const p of res.points) {
      const pl = (p.payload ?? {}) as Record<string, unknown>;
      const pathStr = payloadStr(pl, "path");
      if (pathStr) metadataPaths.add(pathStr);
    }
    const nextOff = res.next_page_offset;
    if (nextOff === null || nextOff === undefined) break;
    offset = nextOff as string | number;
  }

  return {
    contentByPath,
    metadataPaths,
    hashToCanonicalPath,
    contentVectorsByHash,
  };
}

function filePayload(
  sourceId: string,
  filePath: string,
  contentHash: string,
  sizeBytes: number,
  mtimeMs: number,
  tagIds: string[],
): Record<string, unknown> {
  const fileName = path.basename(filePath);
  const extension = path.extname(filePath).replace(/^\./, "").toLowerCase();
  return {
    sourceId,
    path: filePath,
    contentHash,
    fileName,
    extension,
    sizeBytes,
    mtimeMs,
    tagIds,
  };
}

async function existingTagIds(
  client: QdrantClient,
  collection: string,
  id: string,
): Promise<string[]> {
  try {
    const pts = await client.retrieve(collection, {
      ids: [id],
      with_payload: true,
      with_vector: false,
    });
    const p = pts[0];
    return payloadTagIds((p?.payload ?? {}) as Record<string, unknown>);
  } catch {
    return [];
  }
}

export async function upsertMetadata(
  client: QdrantClient,
  args: { sourceId: string; path: string; contentHash: string },
): Promise<UpsertMetadataResult> {
  const id = pointId(args.sourceId, args.path);
  const contentPoint = await client
    .retrieve(CONTENT_COLLECTION_NAME, {
      ids: [id],
      with_payload: true,
      with_vector: true,
    })
    .catch(() => []);
  const metaPoint = await client
    .retrieve(METADATA_COLLECTION_NAME, {
      ids: [id],
      with_payload: true,
      with_vector: true,
    })
    .catch(() => []);

  const cp = contentPoint[0];
  const mp = metaPoint[0];
  const pl = (cp?.payload ?? {}) as Record<string, unknown>;
  const existingHash = payloadStr(pl, "contentHash");
  const contentHasVector = cp?.vector !== undefined && cp.vector !== null;
  const metadataHasVector = mp?.vector !== undefined && mp.vector !== null;
  const hashMatches = existingHash === args.contentHash;
  const reusableContentVector = hashMatches && contentHasVector;
  return {
    shouldEmbedContent: !reusableContentVector,
    shouldEmbedMetadata: !(hashMatches && metadataHasVector),
  };
}

export type UpsertEmbeddingArgs = {
  sourceId: string;
  path: string;
  contentHash: string;
  sizeBytes: number;
  mtimeMs: number;
  embedding: number[];
};

export type UpsertMetadataEmbeddingArgs = {
  sourceId: string;
  path: string;
  contentHash: string;
  sizeBytes: number;
  mtimeMs: number;
  metadataEmbedding: number[];
};

export async function buildContentPoint(
  client: QdrantClient,
  args: UpsertEmbeddingArgs,
): Promise<{
  id: string | number;
  vector: number[];
  payload: Record<string, unknown>;
}> {
  if (args.embedding.length !== VECTOR_DIM) {
    throw new Error(
      `Embedding length ${args.embedding.length} does not match expected dimensions ${VECTOR_DIM}.`,
    );
  }
  const id = pointId(args.sourceId, args.path);
  let tagIds = await existingTagIds(client, CONTENT_COLLECTION_NAME, id);
  if (tagIds.length === 0) {
    tagIds = await existingTagIds(client, METADATA_COLLECTION_NAME, id);
  }
  const payload = filePayload(
    args.sourceId,
    args.path,
    args.contentHash,
    args.sizeBytes,
    args.mtimeMs,
    tagIds,
  );
  return { id, vector: args.embedding, payload };
}

export async function buildMetadataPoint(
  client: QdrantClient,
  args: UpsertMetadataEmbeddingArgs,
): Promise<{
  id: string | number;
  vector: number[];
  payload: Record<string, unknown>;
}> {
  if (args.metadataEmbedding.length !== VECTOR_DIM) {
    throw new Error(
      `Metadata embedding length ${args.metadataEmbedding.length} does not match expected dimensions ${VECTOR_DIM}.`,
    );
  }
  const id = pointId(args.sourceId, args.path);
  let tagIds = await existingTagIds(client, METADATA_COLLECTION_NAME, id);
  if (tagIds.length === 0) {
    tagIds = await existingTagIds(client, CONTENT_COLLECTION_NAME, id);
  }
  const payload = filePayload(
    args.sourceId,
    args.path,
    args.contentHash,
    args.sizeBytes,
    args.mtimeMs,
    tagIds,
  );
  return { id, vector: args.metadataEmbedding, payload };
}

export async function upsertContentPointsBatch(
  client: QdrantClient,
  points: Array<{
    id: string | number;
    vector: number[];
    payload: Record<string, unknown>;
  }>,
): Promise<void> {
  if (points.length === 0) return;
  await client.upsert(CONTENT_COLLECTION_NAME, {
    wait: true,
    points,
  });
}

export async function upsertMetadataPointsBatch(
  client: QdrantClient,
  points: Array<{
    id: string | number;
    vector: number[];
    payload: Record<string, unknown>;
  }>,
): Promise<void> {
  if (points.length === 0) return;
  await client.upsert(METADATA_COLLECTION_NAME, {
    wait: true,
    points,
  });
}

export type BatcherFlushStats = {
  contentPoints: number;
  metadataPoints: number;
  elapsedMs: number;
};

export class EmbeddingUpsertBatcher {
  private contentBuf: Array<{
    id: string | number;
    vector: number[];
    payload: Record<string, unknown>;
  }> = [];
  private metadataBuf: typeof this.contentBuf = [];

  async enqueueContent(
    client: QdrantClient,
    args: UpsertEmbeddingArgs,
  ): Promise<BatcherFlushStats> {
    const pt = await buildContentPoint(client, args);
    this.contentBuf.push(pt);
    if (this.contentBuf.length >= EMBEDDING_QDRANT_UPSERT_BATCH) {
      const chunk = this.contentBuf;
      this.contentBuf = [];
      const started = Date.now();
      await upsertContentPointsBatch(client, chunk);
      return {
        contentPoints: chunk.length,
        metadataPoints: 0,
        elapsedMs: Date.now() - started,
      };
    }
    return { contentPoints: 0, metadataPoints: 0, elapsedMs: 0 };
  }

  async enqueueMetadata(
    client: QdrantClient,
    args: UpsertMetadataEmbeddingArgs,
  ): Promise<BatcherFlushStats> {
    const pt = await buildMetadataPoint(client, args);
    this.metadataBuf.push(pt);
    if (this.metadataBuf.length >= EMBEDDING_QDRANT_UPSERT_BATCH) {
      const chunk = this.metadataBuf;
      this.metadataBuf = [];
      const started = Date.now();
      await upsertMetadataPointsBatch(client, chunk);
      return {
        contentPoints: 0,
        metadataPoints: chunk.length,
        elapsedMs: Date.now() - started,
      };
    }
    return { contentPoints: 0, metadataPoints: 0, elapsedMs: 0 };
  }

  async flush(client: QdrantClient): Promise<BatcherFlushStats> {
    const started = Date.now();
    let cp = 0;
    let mp = 0;
    if (this.contentBuf.length > 0) {
      cp = this.contentBuf.length;
      await upsertContentPointsBatch(client, this.contentBuf);
      this.contentBuf = [];
    }
    if (this.metadataBuf.length > 0) {
      mp = this.metadataBuf.length;
      await upsertMetadataPointsBatch(client, this.metadataBuf);
      this.metadataBuf = [];
    }
    return {
      contentPoints: cp,
      metadataPoints: mp,
      elapsedMs: Date.now() - started,
    };
  }

  hasPending(): boolean {
    return this.contentBuf.length > 0 || this.metadataBuf.length > 0;
  }
}

export type SemanticSearchChannel = "content" | "metadata";

export type SemanticSearchArgs = {
  sourceId: string;
  queryVector: number[];
  limit?: number;
  channel?: SemanticSearchChannel;
};

export type SemanticSearchFile = { path: string; contentHash: string };
export type SemanticSearchHit = { score: number; file: SemanticSearchFile };

export async function semanticSearch(
  client: QdrantClient,
  args: SemanticSearchArgs,
): Promise<SemanticSearchHit[]> {
  if (args.queryVector.length !== VECTOR_DIM) {
    throw new Error(
      `Query vector length ${args.queryVector.length} does not match expected dimensions ${VECTOR_DIM}.`,
    );
  }
  const limit = Math.min(Math.max(args.limit ?? 16, 1), 256);
  const collection =
    args.channel === "metadata"
      ? METADATA_COLLECTION_NAME
      : CONTENT_COLLECTION_NAME;
  const hits = await client.search(collection, {
    vector: args.queryVector,
    limit,
    filter: {
      must: [{ key: "sourceId", match: { value: args.sourceId } }],
    },
    with_payload: true,
    with_vector: false,
  });
  const out: SemanticSearchHit[] = [];
  for (const p of hits) {
    const pl = (p.payload ?? {}) as Record<string, unknown>;
    const pathStr = payloadStr(pl, "path");
    const ch = payloadStr(pl, "contentHash");
    if (pathStr && ch) {
      out.push({
        score: p.score ?? 0,
        file: { path: pathStr, contentHash: ch },
      });
    }
  }
  return out;
}

export async function similarByPath(
  client: QdrantClient,
  args: { sourceId: string; path: string; limit?: number },
): Promise<SemanticSearchHit[]> {
  const id = pointId(args.sourceId, args.path);
  let rows = await client.retrieve(CONTENT_COLLECTION_NAME, {
    ids: [id],
    with_vector: true,
    with_payload: false,
  });
  let qv = rows[0] ? vecFromRecord(rows[0].vector) : null;
  if (!qv || qv.length !== VECTOR_DIM) {
    rows = await client.retrieve(METADATA_COLLECTION_NAME, {
      ids: [id],
      with_vector: true,
      with_payload: false,
    });
    qv = rows[0] ? vecFromRecord(rows[0].vector) : null;
  }
  if (!qv || qv.length !== VECTOR_DIM) {
    throw new Error(
      "No embedding for this file in the index (it may have been removed or never embedded).",
    );
  }
  const limit = Math.min(Math.max(args.limit ?? 16, 1), 256);
  const searchLimit = Math.min(limit + 8, 256);
  const hits = await client.search(CONTENT_COLLECTION_NAME, {
    vector: qv,
    limit: searchLimit,
    filter: {
      must: [{ key: "sourceId", match: { value: args.sourceId } }],
    },
    with_payload: true,
    with_vector: false,
  });
  const out: SemanticSearchHit[] = [];
  for (const p of hits) {
    const pl = (p.payload ?? {}) as Record<string, unknown>;
    const pathStr = payloadStr(pl, "path");
    if (!pathStr || pathStr === args.path) continue;
    const ch = payloadStr(pl, "contentHash");
    if (!ch) continue;
    out.push({ score: p.score ?? 0, file: { path: pathStr, contentHash: ch } });
    if (out.length >= limit) break;
  }
  return out;
}

export async function countPoints(
  client: QdrantClient,
  sourceId: string,
): Promise<{ count: number }> {
  const r = await client.count(CONTENT_COLLECTION_NAME, {
    filter: { must: [{ key: "sourceId", match: { value: sourceId } }] },
    exact: true,
  });
  return {
    count: typeof r.count === "number" ? r.count : Number(r.count ?? 0),
  };
}

export type ScrollGraphArgs = {
  sourceId: string;
  limit?: number;
  tagFilterIds?: string[];
};

export type ScrollGraphResult = {
  points: Array<{ path: string; contentHash: string; tagIds: string[] }>;
  packedEmbeddingsF32Base64: string;
  n: number;
  d: number;
};

const SCROLL_CONTENT_VECTORS_HARD_MAX = 5000;

function graphFilter(sourceId: string, tagFilterIds: string[]) {
  const must: unknown[] = [{ key: "sourceId", match: { value: sourceId } }];
  if (tagFilterIds.length > 0) {
    must.push({
      should: tagFilterIds.map((id) => ({
        key: "tagIds",
        match: { value: id },
      })),
    });
  }
  return { must };
}

function packEmbeddings(points: Array<{ embedding: number[] }>): {
  b64: string;
  n: number;
  d: number;
} {
  const n = points.length;
  if (n === 0) return { b64: "", n: 0, d: 0 };
  const d = points[0].embedding.length;
  const buf = Buffer.allocUnsafe(n * d * 4);
  let o = 0;
  for (const p of points) {
    for (const f of p.embedding) {
      buf.writeFloatLE(f, o);
      o += 4;
    }
  }
  return { b64: buf.toString("base64"), n, d };
}

export async function scrollGraph(
  client: QdrantClient,
  args: ScrollGraphArgs,
): Promise<{ result: ScrollGraphResult; stalePaths: string[] }> {
  const requested = args.limit ?? 500;
  const limit = Math.min(
    Math.max(requested, 1),
    SCROLL_CONTENT_VECTORS_HARD_MAX,
  );
  const tagFilter = args.tagFilterIds ?? [];
  const res = await client.scroll(CONTENT_COLLECTION_NAME, {
    filter: graphFilter(args.sourceId, tagFilter) as {
      must: Record<string, unknown>[];
    },
    limit,
    with_payload: true,
    with_vector: true,
  });

  type GP = {
    path: string;
    contentHash: string;
    embedding: number[];
    tagIds: string[];
  };
  const collected: GP[] = [];
  for (const p of res.points) {
    const pl = (p.payload ?? {}) as Record<string, unknown>;
    const pathStr = payloadStr(pl, "path");
    const ch = payloadStr(pl, "contentHash");
    const vec = vecFromRecord(p.vector);
    if (!pathStr || !ch || !vec || vec.length !== VECTOR_DIM) continue;
    collected.push({
      path: pathStr,
      contentHash: ch,
      embedding: vec,
      tagIds: payloadTagIds(pl),
    });
  }

  const stalePaths: string[] = [];
  const existing: GP[] = [];
  for (const pt of collected) {
    try {
      await fs.access(pt.path);
      existing.push(pt);
    } catch {
      stalePaths.push(pt.path);
    }
  }

  const meta = existing.map((p) => ({
    path: p.path,
    contentHash: p.contentHash,
    tagIds: p.tagIds,
  }));
  const packed = packEmbeddings(existing);
  return {
    result: {
      points: meta,
      packedEmbeddingsF32Base64: packed.b64,
      n: packed.n,
      d: packed.d,
    },
    stalePaths,
  };
}

export async function setPathTagIds(
  client: QdrantClient,
  args: { sourceId: string; path: string; tagIds: string[] },
): Promise<void> {
  const id = pointId(args.sourceId, args.path);
  const payload = { tagIds: args.tagIds };
  for (const coll of [CONTENT_COLLECTION_NAME, METADATA_COLLECTION_NAME]) {
    const pts = await client
      .retrieve(coll, { ids: [id], with_payload: false, with_vector: false })
      .catch(() => []);
    if (pts.length === 0) continue;
    await client.setPayload(coll, {
      wait: true,
      payload,
      points: [id],
    });
  }
}

export async function deleteAllPoints(
  client: QdrantClient,
  sourceId: string,
): Promise<void> {
  const filt = {
    filter: { must: [{ key: "sourceId", match: { value: sourceId } }] },
  };
  for (const coll of [CONTENT_COLLECTION_NAME, METADATA_COLLECTION_NAME]) {
    await client.delete(coll, { wait: true, ...filt });
  }
}

export async function deletePointsForPaths(
  client: QdrantClient,
  sourceId: string,
  paths: string[],
): Promise<{ deletedCount: number }> {
  const uniq = [...new Set(paths)];
  const ids = uniq.map((p) => pointId(sourceId, p));
  if (ids.length === 0) return { deletedCount: 0 };
  const CHUNK = 512;
  let deleted = 0;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    for (const coll of [CONTENT_COLLECTION_NAME, METADATA_COLLECTION_NAME]) {
      await client.delete(coll, { wait: true, points: chunk });
    }
    deleted += chunk.length;
  }
  return { deletedCount: deleted };
}

export async function pathsUnderIncludeRoot(
  client: QdrantClient,
  sourceId: string,
  includePath: string,
): Promise<string[]> {
  const root = path.normalize(includePath);
  const seen = new Set<string>();
  const paths: string[] = [];
  let offset: string | number | undefined;
  const filt = { must: [{ key: "sourceId", match: { value: sourceId } }] };
  for (;;) {
    const res = await client.scroll(CONTENT_COLLECTION_NAME, {
      filter: filt,
      limit: 256,
      offset,
      with_payload: true,
      with_vector: false,
    });
    for (const p of res.points) {
      const pl = (p.payload ?? {}) as Record<string, unknown>;
      const pathStr = payloadStr(pl, "path");
      if (!pathStr) continue;
      if (isUnderDir(pathStr, root) && !seen.has(pathStr)) {
        seen.add(pathStr);
        paths.push(pathStr);
      }
    }
    const nextOff = res.next_page_offset;
    if (nextOff === null || nextOff === undefined) break;
    offset = nextOff as string | number;
  }
  return paths;
}

export function resetQdrantConnectionCache(): void {
  lastFailedAt = 0;
  lastError = null;
}

export async function qdrantStatus(): Promise<QdrantStatus> {
  if (Date.now() - lastFailedAt < CONNECT_COOLDOWN_MS && lastError) {
    throw new Error(lastError);
  }
  const grpc =
    runtime.grpcBaseUrl ?? resolveQdrantEnvUrl() ?? "http://127.0.0.1:6334";
  const rest =
    runtime.restBaseUrl ?? grpcUrlToRestBase(resolveQdrantEnvUrl() ?? grpc);
  const c = buildClient(rest);
  try {
    await quickReady(c, rest);
    lastFailedAt = 0;
    lastError = null;
    return { baseUrl: grpc };
  } catch (e) {
    lastFailedAt = Date.now();
    lastError = `${String(e)}${devDockerHint()}`;
    throw new Error(lastError);
  }
}

export async function ensureStarted(): Promise<void> {
  if (Date.now() - lastFailedAt < CONNECT_COOLDOWN_MS && lastError) {
    throw new Error(lastError);
  }

  const envUrl = resolveQdrantEnvUrl();
  if (envUrl) {
    const rest = grpcUrlToRestBase(envUrl);
    runtime.grpcBaseUrl = envUrl;
    runtime.restBaseUrl = rest;
    cachedClient = buildClient(rest);
    clientRestUrl = rest;
    try {
      await quickReady(cachedClient, rest);
      await ensureCollections(cachedClient);
      lastFailedAt = 0;
      lastError = null;
    } catch (e) {
      lastFailedAt = Date.now();
      lastError = `${String(e)}${devDockerHint()}`;
      throw new Error(lastError);
    }
    return;
  }

  if (runtime.restBaseUrl && cachedClient) {
    await quickReady(cachedClient, runtime.restBaseUrl);
    await ensureCollections(cachedClient);
    return;
  }

  const defaultRest = "http://127.0.0.1:6333";
  const tryClient = buildClient(defaultRest);
  const ready = await quickReady(tryClient, defaultRest).then(
    () => true,
    () => false,
  );
  if (ready) {
    runtime.grpcBaseUrl = "http://127.0.0.1:6334";
    runtime.restBaseUrl = defaultRest;
    runtime.httpDashboardPort = 6333;
    cachedClient = tryClient;
    clientRestUrl = defaultRest;
    await ensureCollections(cachedClient);
    lastFailedAt = 0;
    lastError = null;
    return;
  }

  const httpPort = await findAvailablePort(6333);
  const grpcPort = await findAvailablePort(Math.max(httpPort + 1, 6334));
  const binary = qdrantBinaryPath();
  const storagePath = path.join(app.getPath("userData"), "qdrant", "storage");
  await fs.mkdir(storagePath, { recursive: true });

  const child = spawn(binary, [], {
    env: {
      ...process.env,
      QDRANT__STORAGE__STORAGE_PATH: storagePath,
      QDRANT__SERVICE__HTTP_PORT: String(httpPort),
      QDRANT__SERVICE__GRPC_PORT: String(grpcPort),
    },
    stdio: "ignore",
  });
  runtime.child = child;
  runtime.grpcBaseUrl = `http://127.0.0.1:${grpcPort}`;
  runtime.restBaseUrl = `http://127.0.0.1:${httpPort}`;
  runtime.httpDashboardPort = httpPort;

  const c = buildClient(runtime.restBaseUrl);
  for (let i = 0; i < 30; i++) {
    const ok = await quickReady(c, runtime.restBaseUrl).then(
      () => true,
      () => false,
    );
    if (ok) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  await quickReady(c, runtime.restBaseUrl);
  cachedClient = c;
  clientRestUrl = runtime.restBaseUrl;
  await ensureCollections(cachedClient);
  lastFailedAt = 0;
  lastError = null;
}

export async function shutdown(): Promise<void> {
  cachedClient = null;
  clientRestUrl = null;
  runtime.grpcBaseUrl = null;
  runtime.restBaseUrl = null;
  runtime.httpDashboardPort = null;
  const ch = runtime.child;
  runtime.child = null;
  if (ch) {
    ch.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      ch.once("exit", () => resolve());
      setTimeout(resolve, 3000);
    });
  }
}
