import { ipcMain } from "electron";
import { devLog } from "../core/log.js";
import {
  cancelEmbeddingJob,
  clampVisionRasterOptions,
  embeddingJobStatus,
  pauseEmbeddingJob,
  resumeEmbeddingJob,
  startEmbeddingJob,
} from "../services/embedding-job.js";
import {
  embedQueryTextCached,
  readGeminiApiKeyOrThrow,
} from "../services/gemini-api.js";
import * as q from "../services/qdrant.js";
import type { ScanFilesArgs } from "../services/scan-walk.js";
import { type IpcContext, unwrapArgs } from "./context.js";

export function registerEmbeddingHandlers(ctx: IpcContext): void {
  ipcMain.handle("start_embedding_job", async (_e, payload) => {
    const args = unwrapArgs<{
      scan: ScanFilesArgs;
      sourceId: string;
      visionRaster?: { maxEdgePx: number; jpegQuality: number };
    }>(payload);
    await q.ensureStarted();
    const vision = clampVisionRasterOptions(
      args.visionRaster ?? { maxEdgePx: 1536, jpegQuality: 85 },
    );
    void startEmbeddingJob({
      scan: args.scan,
      sourceId: args.sourceId,
      visionRaster: vision,
      userDataDir: ctx.ud(),
      textIndex: ctx.textIndex,
      broadcast: ctx.broadcast,
    }).catch((e) => {
      devLog.error("start_embedding_job failed", {
        error: e instanceof Error ? e.message : String(e),
      });
      ctx.broadcast("embedding://error", { message: String(e) });
    });
  });

  ipcMain.handle("pause_embedding_job", () => pauseEmbeddingJob());
  ipcMain.handle("resume_embedding_job", () => resumeEmbeddingJob());
  ipcMain.handle("cancel_embedding_job", () => cancelEmbeddingJob());
  ipcMain.handle("embedding_job_status", () => embeddingJobStatus());

  ipcMain.handle("embed_query_text", async (_e, payload) => {
    const args = unwrapArgs<{ text: string }>(payload);
    const apiKey = await readGeminiApiKeyOrThrow();
    return embedQueryTextCached(apiKey, args.text);
  });

  ipcMain.handle("text_index_full_text_for_path", async (_e, payload) => {
    const args = unwrapArgs<{ sourceId: string; path: string }>(payload);
    const v = await ctx.textIndex.getFullTextForPath(
      ctx.ud(),
      args.sourceId,
      args.path,
    );
    return v ?? null;
  });
}
