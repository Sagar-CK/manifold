import fs from "node:fs/promises";
import { ipcMain } from "electron";
import { thumbnailImageBase64Png } from "../services/thumbnails.js";
import { unwrapArgs } from "./context.js";

export function registerFileHandlers(): void {
  ipcMain.handle("read_file_base64", async (_e, payload: unknown) => {
    const args = unwrapArgs<{
      path: string;
      max_bytes?: number;
      maxBytes?: number;
    }>(payload);
    const maxBytes = args.max_bytes ?? args.maxBytes;
    if (maxBytes === undefined) {
      throw new Error("read_file_base64: maxBytes/max_bytes is required");
    }
    const p = args.path;
    const st = await fs.stat(p);
    if (st.size > maxBytes) {
      throw new Error(
        `File too large to read (${st.size} > ${maxBytes} bytes)`,
      );
    }
    const buf = await fs.readFile(p);
    return { base64: buf.toString("base64"), sizeBytes: st.size };
  });

  ipcMain.handle("thumbnail_image_base64_png", async (_e, payload) => {
    const args = unwrapArgs<{
      path: string;
      max_edge: number;
      page?: number;
    }>(payload);
    return thumbnailImageBase64Png(args);
  });
}
