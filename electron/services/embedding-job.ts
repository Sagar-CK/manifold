import "../pdf/pdfjs-node-shim.js";
import fs from "node:fs/promises";
import path from "node:path";
import pLimit from "p-limit";
import sharp from "sharp";
import { devLog } from "../core/log.js";
import { getPdfjsNodeDocumentInit } from "../pdf/pdfjs-document-init.js";
import { importPdfjsLegacy } from "../pdf/pdfjs-import.js";
import {
  clearGeminiQueryCache,
  embedMultimodal,
  embedQueryTextCached,
  extractTextWithGemini,
  readGeminiApiKeyOrThrow,
} from "./gemini-api.js";
import type { SourcePreflightIndex } from "./qdrant.js";
import * as q from "./qdrant.js";
import {
  computeSha256,
  MAX_EMBED_FILE_BYTES,
  SCAN_HASH_MAX_BYTES,
  type ScanFilesArgs,
  type ScanWalkCandidate,
  walkScanCandidates,
} from "./scan-walk.js";
import {
  normalizeForMatch,
  type TextIndexState,
  type UpsertTextArgs,
} from "./text-index.js";

const HASH_PARALLEL = 8;
const FILE_PARALLEL = 8;
const PDF_LOCAL_TEXT_MIN_NONSPACE = 48;
const QDRANT_VISIBILITY_FLUSH_INTERVAL_MS = 1500;
const QDRANT_VISIBILITY_FLUSH_FILE_INTERVAL = 8;

export type EmbeddingJobPhase =
  | "idle"
  | "scanning"
  | "embedding"
  | "paused"
  | "cancelling"
  | "done"
  | "error";

export type EmbeddingJobStatus = {
  phase: EmbeddingJobPhase;
  processed: number;
  total: number;
  message: string;
};

export type VisionRasterOptions = {
  maxEdgePx: number;
  jpegQuality: number;
};

export function clampVisionRasterOptions(
  o: VisionRasterOptions,
): VisionRasterOptions {
  return {
    maxEdgePx: Math.min(Math.max(o.maxEdgePx, 256), 2048),
    jpegQuality: Math.min(Math.max(o.jpegQuality, 50), 95),
  };
}

function mimeForExt(ext: string): string | undefined {
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "pdf":
      return "application/pdf";
    case "mp3":
      return "audio/mpeg";
    case "wav":
      return "audio/wav";
    case "mp4":
      return "video/mp4";
    case "mov":
      return "video/quicktime";
    default:
      return undefined;
  }
}

function supportsTextExtraction(ext: string): boolean {
  return ext === "png" || ext === "jpg" || ext === "jpeg" || ext === "pdf";
}

function metadataTextForPath(filePath: string): string {
  const fileName = path.basename(filePath);
  const extension = path.extname(filePath).replace(/^\./, "").toLowerCase();
  return `filename: ${fileName}\nextension: ${extension}`;
}

function bodyAfterMetadataPrefix(full: string, metaPrefix: string): string {
  if (full.startsWith(metaPrefix)) {
    return full.slice(metaPrefix.length).replace(/^\n+/, "");
  }
  return "";
}

async function prepareRasterImageForGemini(
  bytes: Buffer,
  opts: VisionRasterOptions,
): Promise<{ bytes: Buffer; mime: string }> {
  const img = sharp(bytes);
  const meta = await img.metadata();
  const w = meta.width ?? opts.maxEdgePx;
  const h = meta.height ?? opts.maxEdgePx;
  const scale = Math.min(1, opts.maxEdgePx / Math.max(w, h));
  const tw = Math.max(1, Math.round(w * scale));
  const th = Math.max(1, Math.round(h * scale));
  const out = await img
    .resize(tw, th, { fit: "inside" })
    .jpeg({ quality: opts.jpegQuality })
    .toBuffer();
  return { bytes: out, mime: "image/jpeg" };
}

async function extractPdfTextPdfjs(filePath: string): Promise<string> {
  const data = await fs.readFile(filePath);
  const pdfjs = await importPdfjsLegacy();
  const loadingTask = pdfjs.getDocument({
    ...getPdfjsNodeDocumentInit(),
    data: new Uint8Array(data),
    useSystemFonts: true,
  });
  const doc = await loadingTask.promise;
  const maxChars = 512 * 1024;
  let out = "";
  for (let i = 1; i <= doc.numPages; i++) {
    if (out.length >= maxChars) break;
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    const pageText = tc.items
      .map((it) => ("str" in it ? (it as { str: string }).str : ""))
      .join(" ");
    if (pageText.trim()) {
      if (out) out += "\n";
      const remain = maxChars - out.length;
      out += pageText.length <= remain ? pageText : pageText.slice(0, remain);
    }
  }
  return out;
}

type BroadcastFn = (channel: string, payload: unknown) => void;

type Pending = {
  candidate: ScanWalkCandidate;
  pathStr: string;
  contentHash: string;
  shouldEmbedContent: boolean;
  shouldEmbedMetadata: boolean;
  skipFileRead: boolean;
  precopiedContentEmbedding?: number[];
  precopyExtractedText?: string;
};

const state = {
  running: false,
  phase: "idle" as EmbeddingJobPhase,
  processed: 0,
  total: 0,
  message: "Idle",
  paused: false,
  cancelled: false,
};

export function embeddingJobStatus(): EmbeddingJobStatus {
  return {
    phase: state.phase,
    processed: state.processed,
    total: state.total,
    message: state.message,
  };
}

export async function pauseEmbeddingJob(): Promise<void> {
  state.paused = true;
  state.phase = "paused";
}

export async function resumeEmbeddingJob(): Promise<void> {
  state.paused = false;
  if (state.running) state.phase = "embedding";
}

export async function cancelEmbeddingJob(): Promise<void> {
  state.cancelled = true;
  state.phase = "cancelling";
}

async function waitUnpaused(): Promise<void> {
  while (state.paused && !state.cancelled) {
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function precopyExtractedForDuplicate(
  textIndex: TextIndexState,
  userDataDir: string,
  sourceId: string,
  index: SourcePreflightIndex,
  contentHash: string,
  currentPath: string,
): Promise<string | undefined> {
  const canon = index.hashToCanonicalPath.get(contentHash);
  if (!canon || canon === currentPath) return undefined;
  const full = await textIndex.getFullTextForPath(userDataDir, sourceId, canon);
  if (!full) return undefined;
  const meta = metadataTextForPath(canon);
  const body = bodyAfterMetadataPrefix(full, meta);
  return body.trim() ? body : undefined;
}

async function collectPending(
  scan: ScanFilesArgs,
  sourceId: string,
  client: ReturnType<typeof q.getClient>,
  userDataDir: string,
  textIndex: TextIndexState,
): Promise<Pending[]> {
  const candidates = await walkScanCandidates(scan, MAX_EMBED_FILE_BYTES);
  const index = await q.loadSourcePreflightIndex(client, sourceId);
  type Staged = {
    idx: number;
    pathStr: string;
    c: ScanWalkCandidate;
    reusedHash?: string;
  };
  const staged: Staged[] = [];
  let idx = 0;
  for (const c of candidates) {
    if (state.cancelled) return [];
    const pathStr = c.path;
    const reusedHash = q.reuseHashIfFingerprintMatches(
      pathStr,
      c.sizeBytes,
      c.mtimeMs,
      index,
    );
    staged.push({ idx, pathStr, c, reusedHash });
    idx += 1;
  }

  const limitHash = pLimit(HASH_PARALLEL);
  const hashTasks = staged
    .filter((s) => !s.reusedHash)
    .map((s) =>
      limitHash(async () => {
        if (state.cancelled) throw new Error("Cancelled");
        const h = await computeSha256(s.c.path, SCAN_HASH_MAX_BYTES);
        return { idx: s.idx, hash: h };
      }),
    );
  const hashResults = await Promise.allSettled(hashTasks);
  const computed = new Map<number, string>();
  for (const r of hashResults) {
    if (r.status === "fulfilled") computed.set(r.value.idx, r.value.hash);
  }

  const out: Pending[] = [];
  for (const s of staged) {
    if (state.cancelled) return [];
    const contentHash = s.reusedHash ?? computed.get(s.idx);
    if (!contentHash) continue;
    const need = q.decideEmbeddingNeedFromIndex(s.pathStr, contentHash, index);
    if (!need.shouldEmbedContent && !need.shouldEmbedMetadata) continue;

    let precopiedContentEmbedding: number[] | undefined;
    let precopyExtractedText: string | undefined;
    let skipFileRead = false;
    if (need.shouldEmbedContent) {
      const dup = q.duplicateContentVectorForPath(
        index,
        contentHash,
        s.pathStr,
      );
      if (dup) {
        precopiedContentEmbedding = dup;
        precopyExtractedText = await precopyExtractedForDuplicate(
          textIndex,
          userDataDir,
          sourceId,
          index,
          contentHash,
          s.pathStr,
        );
        skipFileRead = Boolean(precopyExtractedText?.trim());
      }
    }

    out.push({
      candidate: s.c,
      pathStr: s.pathStr,
      contentHash,
      shouldEmbedContent: need.shouldEmbedContent,
      shouldEmbedMetadata: need.shouldEmbedMetadata,
      skipFileRead,
      precopiedContentEmbedding,
      precopyExtractedText,
    });
  }
  return out;
}

async function maybeFlushBatcher(
  batcher: q.EmbeddingUpsertBatcher,
  client: ReturnType<typeof q.getClient>,
  processed: number,
  lastFlushAt: { v: number },
  lastFlushProcessed: { v: number },
  force: boolean,
): Promise<void> {
  const due =
    force ||
    processed - lastFlushProcessed.v >= QDRANT_VISIBILITY_FLUSH_FILE_INTERVAL ||
    Date.now() - lastFlushAt.v >= QDRANT_VISIBILITY_FLUSH_INTERVAL_MS;
  if (!due) return;
  if (!force && !batcher.hasPending()) return;
  await batcher.flush(client);
  lastFlushAt.v = Date.now();
  lastFlushProcessed.v = processed;
}

export async function startEmbeddingJob(opts: {
  scan: ScanFilesArgs;
  sourceId: string;
  visionRaster: VisionRasterOptions;
  userDataDir: string;
  textIndex: TextIndexState;
  broadcast: BroadcastFn;
}): Promise<void> {
  if (state.running) throw new Error("Embedding job already running");
  state.running = true;
  state.cancelled = false;
  state.paused = false;
  state.phase = "scanning";
  state.processed = 0;
  state.total = 0;
  state.message = "Scanning files…";
  const vision = clampVisionRasterOptions(opts.visionRaster);
  const broadcasts = opts.broadcast;

  const emitStatus = () =>
    broadcasts("embedding://status", embeddingJobStatus());
  const emitErr = (msg: string) => {
    devLog.error("embedding job error", { message: msg });
    broadcasts("embedding://error", { message: msg });
  };
  const emitDone = () => broadcasts("embedding://done", { ok: true });
  const emitFileFailed = (filePath: string, reason: string) => {
    devLog.warn("embedding file failed", { path: filePath, reason });
    broadcasts("embedding://file-failed", { path: filePath, reason });
  };
  const emitFileEmbedded = (filePath: string) => {
    broadcasts("embedding://file-embedded", { path: filePath });
  };

  emitStatus();

  try {
    await readGeminiApiKeyOrThrow();
  } catch (e) {
    state.running = false;
    state.phase = "error";
    state.message = String(e);
    emitStatus();
    emitErr(state.message);
    return;
  }

  const client = q.getClient();
  let pending: Pending[];
  try {
    pending = await collectPending(
      opts.scan,
      opts.sourceId,
      client,
      opts.userDataDir,
      opts.textIndex,
    );
  } catch (e) {
    state.running = false;
    state.phase = "error";
    state.message = String(e);
    emitStatus();
    emitErr(state.message);
    return;
  }

  state.total = pending.length;
  state.phase = "embedding";
  state.message =
    pending.length === 0
      ? "No new or changed files to embed."
      : `Embedding ${pending.length} file(s)…`;
  emitStatus();

  if (pending.length === 0) {
    state.phase = "done";
    state.message = "Done";
    state.running = false;
    emitDone();
    emitStatus();
    return;
  }

  const apiKey = await readGeminiApiKeyOrThrow();
  const batcher = new q.EmbeddingUpsertBatcher();
  const hashRuntimeCache = new Map<string, { vec: number[]; text: string }>();
  const limitFiles = pLimit(FILE_PARALLEL);
  let processed = 0;
  const lastFlushAt = { v: Date.now() };
  const lastFlushProcessed = { v: 0 };
  const embeddedPaths = new Set<string>();

  const tasks = pending.map((p) =>
    limitFiles(async () => {
      if (state.cancelled) return;
      await waitUnpaused();
      if (state.cancelled) return;

      const filePath = p.candidate.path;
      const ext = p.candidate.ext;
      const mime = mimeForExt(ext);
      const metaTxt = metadataTextForPath(filePath);
      let precEmb = p.precopiedContentEmbedding;
      let precTxt = p.precopyExtractedText;
      let skipRead = p.skipFileRead;

      if (!precEmb && p.shouldEmbedContent) {
        const cached = hashRuntimeCache.get(p.contentHash);
        if (cached?.vec) {
          precEmb = cached.vec;
          if (cached.text.trim()) {
            precTxt = cached.text;
            skipRead = true;
          }
        }
      }

      let bytes: Buffer | null = null;
      if (!skipRead && p.shouldEmbedContent) {
        try {
          bytes = await fs.readFile(filePath);
          if (bytes.byteLength === 0) {
            bytes = null;
          }
        } catch (e) {
          emitFileFailed(filePath, `file read failed: ${String(e)}`);
          processed += 1;
          state.processed = processed;
          emitStatus();
          return;
        }
      }

      let visionBytes: Buffer | null = null;
      let visionMime: string | null = null;
      if (bytes && (ext === "png" || ext === "jpg" || ext === "jpeg")) {
        try {
          const prep = await prepareRasterImageForGemini(bytes, vision);
          visionBytes = prep.bytes;
          visionMime = prep.mime;
        } catch {
          visionBytes = bytes;
          visionMime = mime ?? "application/octet-stream";
        }
      } else if (bytes) {
        visionBytes = bytes;
        visionMime = mime ?? "application/octet-stream";
      }

      let contentVec: number[] | undefined = precEmb;
      if (p.shouldEmbedContent && !contentVec && visionBytes && visionMime) {
        try {
          contentVec = await embedMultimodal(
            apiKey,
            visionMime,
            new Uint8Array(visionBytes),
          );
        } catch (e) {
          emitFileFailed(filePath, `embedding request failed: ${String(e)}`);
          processed += 1;
          state.processed = processed;
          emitStatus();
          return;
        }
      }

      let metaVec: number[] | undefined;
      if (p.shouldEmbedMetadata) {
        try {
          metaVec = await embedQueryTextCached(apiKey, metaTxt);
        } catch (e) {
          emitFileFailed(filePath, `metadata embedding failed: ${String(e)}`);
          processed += 1;
          state.processed = processed;
          emitStatus();
          return;
        }
      }

      let extracted: string | undefined = precTxt;
      let extractedSource: "none" | "pdf" | "gemini" = precTxt?.trim()
        ? "pdf"
        : "none";
      if (
        p.shouldEmbedContent &&
        supportsTextExtraction(ext) &&
        extracted === undefined
      ) {
        if (ext === "pdf" && bytes) {
          try {
            const local = await extractPdfTextPdfjs(filePath);
            const nonspace = [...local].filter((c) => !/\s/.test(c)).length;
            if (nonspace >= PDF_LOCAL_TEXT_MIN_NONSPACE) {
              extracted = local;
              extractedSource = "pdf";
            }
          } catch {
            // fall through to Gemini
          }
        }
        if (extracted === undefined && visionBytes && visionMime) {
          try {
            extracted =
              (await extractTextWithGemini(
                apiKey,
                filePath,
                visionMime,
                new Uint8Array(visionBytes),
              )) || undefined;
            if (extracted?.trim()) extractedSource = "gemini";
          } catch {
            extracted = undefined;
            extractedSource = "none";
          }
        }
      }

      try {
        let wroteEmbedding = false;
        if (contentVec && contentVec.length === q.VECTOR_DIM) {
          await batcher.enqueueContent(client, {
            sourceId: opts.sourceId,
            path: p.pathStr,
            contentHash: p.contentHash,
            sizeBytes: p.candidate.sizeBytes,
            mtimeMs: p.candidate.mtimeMs,
            embedding: contentVec,
          });
          wroteEmbedding = true;
        }
        if (metaVec && metaVec.length === q.VECTOR_DIM) {
          await batcher.enqueueMetadata(client, {
            sourceId: opts.sourceId,
            path: p.pathStr,
            contentHash: p.contentHash,
            sizeBytes: p.candidate.sizeBytes,
            mtimeMs: p.candidate.mtimeMs,
            metadataEmbedding: metaVec,
          });
          wroteEmbedding = true;
        }
        if (wroteEmbedding) {
          embeddedPaths.add(p.pathStr);
        }
      } catch (e) {
        emitFileFailed(filePath, `vector upsert failed: ${String(e)}`);
        processed += 1;
        state.processed = processed;
        emitStatus();
        await maybeFlushBatcher(
          batcher,
          client,
          processed,
          lastFlushAt,
          lastFlushProcessed,
          false,
        );
        return;
      }

      if (p.shouldEmbedContent && contentVec) {
        const body = extracted?.trim() ? extracted : "";
        hashRuntimeCache.set(p.contentHash, { vec: contentVec, text: body });
      }

      const direct = extracted?.trim() ? `${metaTxt}\n${extracted}` : metaTxt;
      if (direct.trim()) {
        let normalizedPathPdf = normalizeForMatch(metaTxt);
        let normalizedOcr = "";
        if (extracted?.trim()) {
          if (extractedSource === "pdf") {
            normalizedPathPdf = normalizeForMatch(`${metaTxt}\n${extracted}`);
          } else if (extractedSource === "gemini") {
            normalizedPathPdf = normalizeForMatch(metaTxt);
            normalizedOcr = normalizeForMatch(extracted);
          } else {
            normalizedPathPdf = normalizeForMatch(`${metaTxt}\n${extracted}`);
          }
        }
        const args: UpsertTextArgs = {
          sourceId: opts.sourceId,
          path: p.pathStr,
          contentHash: p.contentHash,
          rawText: direct,
          normalizedPathPdf,
          normalizedOcr,
        };
        await opts.textIndex.upsertText(opts.userDataDir, args);
      }

      processed += 1;
      state.processed = processed;
      state.message = "Embedding in progress…";
      emitStatus();
      await maybeFlushBatcher(
        batcher,
        client,
        processed,
        lastFlushAt,
        lastFlushProcessed,
        false,
      );
    }),
  );

  await Promise.all(tasks);
  await maybeFlushBatcher(
    batcher,
    client,
    processed,
    lastFlushAt,
    lastFlushProcessed,
    true,
  );
  for (const filePath of embeddedPaths) {
    emitFileEmbedded(filePath);
  }

  if (state.cancelled) {
    state.phase = "idle";
    state.message = "Cancelled";
    state.running = false;
    emitErr("Cancelled");
    emitStatus();
    return;
  }

  state.phase = "done";
  state.message = "All files embedded.";
  state.running = false;
  emitDone();
  emitStatus();
}

export function resetEmbeddingGeminiCache(): void {
  clearGeminiQueryCache();
}
