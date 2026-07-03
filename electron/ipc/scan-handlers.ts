import { ipcMain } from "electron";
import pLimit from "p-limit";
import * as q from "../services/qdrant.js";
import {
  computeSha256,
  MAX_EMBED_FILE_BYTES,
  SCAN_HASH_MAX_BYTES,
  type ScanFilesArgs,
  walkScanCandidates,
} from "../services/scan-walk.js";
import { unwrapArgs } from "./context.js";

export function registerScanHandlers(): void {
  ipcMain.handle("scan_files", async (_e, payload) => {
    const args = unwrapArgs<ScanFilesArgs>(payload);
    const candidates = await walkScanCandidates(args, SCAN_HASH_MAX_BYTES);
    const out: Array<{
      path: string;
      sizeBytes: number;
      mtimeMs: number;
      sha256: string;
    }> = [];
    for (const c of candidates) {
      const sha256 = await computeSha256(c.path, SCAN_HASH_MAX_BYTES);
      out.push({
        path: c.path,
        sizeBytes: c.sizeBytes,
        mtimeMs: c.mtimeMs,
        sha256,
      });
    }
    return out;
  });

  ipcMain.handle("scan_files_count", async (_e, payload) => {
    const args = unwrapArgs<ScanFilesArgs>(payload);
    const candidates = await walkScanCandidates(args, Number.MAX_SAFE_INTEGER);
    return { total: candidates.length };
  });

  ipcMain.handle("scan_files_estimate", async (_e, payload) => {
    const args = unwrapArgs<ScanFilesArgs>(payload);
    const candidates = await walkScanCandidates(args, Number.MAX_SAFE_INTEGER);
    let imageFiles = 0;
    let audioFiles = 0;
    let videoFiles = 0;
    let textLikeFiles = 0;
    let totalTextBytes = 0;
    let totalAudioBytes = 0;
    let totalVideoBytes = 0;
    for (const c of candidates) {
      switch (c.ext) {
        case "png":
        case "jpg":
        case "jpeg":
          imageFiles += 1;
          break;
        case "mp3":
        case "wav":
          audioFiles += 1;
          totalAudioBytes += c.sizeBytes;
          break;
        case "mp4":
        case "mov":
          videoFiles += 1;
          totalVideoBytes += c.sizeBytes;
          break;
        default:
          textLikeFiles += 1;
          totalTextBytes += c.sizeBytes;
          break;
      }
    }
    return {
      total: candidates.length,
      imageFiles,
      audioFiles,
      videoFiles,
      textLikeFiles,
      totalTextBytes,
      totalAudioBytes,
      totalVideoBytes,
    };
  });

  ipcMain.handle("scan_files_needs_embedding", async (_e, payload) => {
    const args = unwrapArgs<{ scan: ScanFilesArgs; sourceId: string }>(payload);
    const candidates = await walkScanCandidates(
      args.scan,
      MAX_EMBED_FILE_BYTES,
    );
    const totalSelected = candidates.length;
    if (candidates.length === 0) {
      return { totalSelected, needsEmbedding: false };
    }
    await q.ensureStarted();
    const client = q.getClient();
    const index = await q.loadSourcePreflightIndex(client, args.sourceId);
    const limitHash = pLimit(8);
    const tasks = candidates.map((c) =>
      limitHash(async () => {
        const pathStr = c.path;
        const reused = q.reuseHashIfFingerprintMatches(
          pathStr,
          c.sizeBytes,
          c.mtimeMs,
          index,
        );
        const contentHash =
          reused ?? (await computeSha256(c.path, SCAN_HASH_MAX_BYTES));
        const d = q.decideEmbeddingNeedFromIndex(pathStr, contentHash, index);
        return d.shouldEmbedContent || d.shouldEmbedMetadata;
      }),
    );
    const results = await Promise.all(tasks);
    const needsEmbedding = results.some(Boolean);
    return { totalSelected, needsEmbedding };
  });
}
