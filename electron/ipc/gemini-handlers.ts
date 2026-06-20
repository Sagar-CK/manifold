import fs from "node:fs/promises";
import path from "node:path";
import { ipcMain } from "electron";
import { clampVisionRasterOptions, resetEmbeddingGeminiCache } from "../embedding-job.js";
import { judgeTag, readGeminiApiKeyOrThrow } from "../gemini-api.js";
import {
  clearGeminiApiKey,
  geminiApiKeyStatus,
  saveGeminiApiKey,
} from "../gemini-key-store.js";
import { MAX_EMBED_FILE_BYTES } from "../scan-walk.js";
import { type IpcContext, unwrapArgs } from "./context.js";

export function registerGeminiHandlers(ctx: IpcContext): void {
  ipcMain.handle("gemini_judge_tag", async (_e, payload) => {
    const args = unwrapArgs<{
      sourceId: string;
      sourcePath: string;
      targetPath: string;
      tagName: string;
      similarityScore: number;
      visionRaster?: { maxEdgePx: number; jpegQuality: number };
    }>(payload);
    const apiKey = await readGeminiApiKeyOrThrow();
    const vision = clampVisionRasterOptions(
      args.visionRaster ?? { maxEdgePx: 1536, jpegQuality: 85 },
    );
    const maxBytes = MAX_EMBED_FILE_BYTES;

    const makePart = async (fp: string): Promise<unknown> => {
      const st = await fs.stat(fp);
      if (st.size > maxBytes) throw new Error("File too large");
      const ext = path.extname(fp).replace(/^\./, "").toLowerCase();
      if (["jpg", "jpeg", "png"].includes(ext)) {
        const bytes = await fs.readFile(fp);
        const sharp = (await import("sharp")).default;
        const img = sharp(bytes);
        const meta = await img.metadata();
        const w = meta.width ?? vision.maxEdgePx;
        const h = meta.height ?? vision.maxEdgePx;
        const scale = Math.min(1, vision.maxEdgePx / Math.max(w, h));
        const tw = Math.max(1, Math.round(w * scale));
        const th = Math.max(1, Math.round(h * scale));
        const jpeg = await img
          .resize(tw, th, { fit: "inside" })
          .jpeg({ quality: vision.jpegQuality })
          .toBuffer();
        return {
          inline_data: {
            mime_type: "image/jpeg",
            data: jpeg.toString("base64"),
          },
        };
      }
      return { fetch_text_for: fp };
    };

    let sp = await makePart(args.sourcePath);
    if (sp && typeof sp === "object" && "fetch_text_for" in sp) {
      let text =
        (await ctx.textIndex.getFullTextForPath(
          ctx.ud(),
          args.sourceId,
          args.sourcePath,
        )) ?? (await fs.readFile(args.sourcePath, "utf8").catch(() => ""));
      if (text.length > 16000) text = text.slice(0, 16000);
      sp = { text };
    }
    let tp = await makePart(args.targetPath);
    if (tp && typeof tp === "object" && "fetch_text_for" in tp) {
      let text =
        (await ctx.textIndex.getFullTextForPath(
          ctx.ud(),
          args.sourceId,
          args.targetPath,
        )) ?? (await fs.readFile(args.targetPath, "utf8").catch(() => ""));
      if (text.length > 16000) text = text.slice(0, 16000);
      tp = { text };
    }
    return judgeTag(apiKey, {
      tagName: args.tagName,
      similarityScore: args.similarityScore,
      sourcePath: args.sourcePath,
      targetPath: args.targetPath,
      sourcePart: sp,
      targetPart: tp,
    });
  });

  ipcMain.handle("gemini_api_key_status", () => geminiApiKeyStatus());

  ipcMain.handle("save_gemini_api_key", async (_e, payload) => {
    const args = unwrapArgs<{ apiKey: string }>(payload);
    await saveGeminiApiKey(args.apiKey);
    resetEmbeddingGeminiCache();
  });

  ipcMain.handle("clear_stored_gemini_api_key", async () => {
    await clearGeminiApiKey();
    resetEmbeddingGeminiCache();
  });
}
