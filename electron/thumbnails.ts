import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { app } from "electron";
import sharp from "sharp";
import { ffmpegBinaryCandidates, resolveFirstExisting } from "./app-paths.js";
import { getPdfjsNodeDocumentInit } from "./pdfjs-document-init.js";
import { importPdfjsLegacy } from "./pdfjs-import.js";
import { installPdfjsNodeShim } from "./pdfjs-node-shim.js";
import { normalizeExt } from "./scan-walk.js";

const THUMB_CACHE_MAX_ENTRIES = 512;
const THUMB_CACHE_SCHEMA_VERSION = "v3";
/** Raster / video thumbnails */
const THUMB_TIMEOUT_RASTER_MS = 12_000;
/** PDF path may use pdftoppm + pdfjs fallback + render */
const THUMB_TIMEOUT_PDF_MS = 45_000;
/** Kill pdftoppm if it stalls (missing binary, bad PDF, etc.) */
const PDFTOPPM_KILL_MS = 10_000;

type CacheEntry = {
  mtimeMs: number;
  sizeBytes: number;
  pngBase64: string;
};

const memCache = new Map<string, CacheEntry>();

function cacheKey(filePath: string, maxEdge: number, page: number): string {
  return `${filePath}::${page}::${maxEdge}`;
}

function fingerprint(mtimeMs: number, sizeBytes: number): string {
  return `${mtimeMs}:${sizeBytes}`;
}

async function diskCachePath(cacheKeyStr: string, fp: string): Promise<string> {
  const dir = path.join(app.getPath("userData"), "thumbnails");
  await fs.mkdir(dir, { recursive: true });
  const { createHash } = await import("node:crypto");
  const h = createHash("sha256");
  h.update(THUMB_CACHE_SCHEMA_VERSION);
  h.update(cacheKeyStr);
  h.update(fp);
  return path.join(dir, `${h.digest("hex")}.b64`);
}

function ffprobeDurationSeconds(
  ffprobePath: string,
  videoPath: string,
): Promise<number | undefined> {
  return new Promise((resolve) => {
    const p = spawn(
      ffprobePath,
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        videoPath,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    p.stdout.on("data", (d) => {
      out += String(d);
    });
    p.on("close", (code) => {
      if (code !== 0) return resolve(undefined);
      const s = parseFloat(out.trim());
      if (!Number.isFinite(s) || s < 0) resolve(undefined);
      else resolve(s);
    });
  });
}

function chooseSeekSeconds(duration: number | undefined): number {
  if (duration !== undefined && Number.isFinite(duration) && duration > 0) {
    return Math.min(30, Math.max(1, duration * 0.1));
  }
  return 1;
}

function ffmpegFramePngBase64(
  ffmpegPath: string,
  videoPath: string,
  maxEdge: number,
  seekSec: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const scale = `scale=${maxEdge}:${maxEdge}:force_original_aspect_ratio=decrease`;
    const p = spawn(
      ffmpegPath,
      [
        "-v",
        "error",
        "-ss",
        String(seekSec.toFixed(3)),
        "-i",
        videoPath,
        "-frames:v",
        "1",
        "-an",
        "-sn",
        "-dn",
        "-vf",
        scale,
        "-f",
        "image2pipe",
        "-vcodec",
        "png",
        "pipe:1",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const chunks: Buffer[] = [];
    let err = "";
    p.stdout.on("data", (c) => chunks.push(c));
    p.stderr.on("data", (c) => {
      err += String(c);
    });
    p.on("close", (code) => {
      const buf = Buffer.concat(chunks);
      if (code !== 0 || buf.length === 0) {
        reject(
          new Error(err.trim() || "ffmpeg did not produce a thumbnail frame"),
        );
        return;
      }
      resolve(buf.toString("base64"));
    });
  });
}

async function renderVideoThumb(
  videoPath: string,
  maxEdge: number,
): Promise<string> {
  const ffmpeg = resolveFirstExisting(ffmpegBinaryCandidates("ffmpeg"));
  const ffprobe = resolveFirstExisting(ffmpegBinaryCandidates("ffprobe"));
  if (!ffmpeg || !ffprobe) {
    throw new Error(
      "ffmpeg/ffprobe not found. Set MANIFOLD_FFMPEG_DIR or run pnpm setup:dev.",
    );
  }
  const dur = await ffprobeDurationSeconds(ffprobe, videoPath);
  const seek = chooseSeekSeconds(dur);
  try {
    return await ffmpegFramePngBase64(ffmpeg, videoPath, maxEdge, seek);
  } catch (e) {
    if (seek > 0) {
      return await ffmpegFramePngBase64(ffmpeg, videoPath, maxEdge, 0);
    }
    throw e;
  }
}

async function renderImageThumb(
  filePath: string,
  maxEdge: number,
): Promise<string> {
  const buf = await fs.readFile(filePath);
  const out = await sharp(buf)
    .resize(maxEdge, maxEdge, { fit: "inside" })
    .png()
    .toBuffer();
  return out.toString("base64");
}

async function renderPdfPdftoppm(
  filePath: string,
  maxEdge: number,
  page: number,
): Promise<string> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "manifold-pdf-"));
  const outPrefix = path.join(tmp, "page");
  const child = spawn(
    "pdftoppm",
    [
      "-f",
      String(page + 1),
      "-l",
      String(page + 1),
      "-png",
      "-scale-to",
      String(maxEdge),
      filePath,
      outPrefix,
    ],
    { stdio: "ignore" },
  );

  const cleanupTmp = () => fs.rm(tmp, { recursive: true, force: true });

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("pdftoppm timed out"));
      }, PDFTOPPM_KILL_MS);
      child.once("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`pdftoppm exited ${code}`));
      });
    });

    const first = path.join(
      tmp,
      `page-${String(page + 1).padStart(2, "0")}.png`,
    );
    const alt = `${outPrefix}-${page + 1}.png`;
    let png: Buffer;
    try {
      png = await fs.readFile(first);
    } catch {
      png = await fs.readFile(alt);
    }
    const resized = await sharp(png)
      .resize(maxEdge, maxEdge, { fit: "inside" })
      .png()
      .toBuffer();
    return resized.toString("base64");
  } finally {
    void cleanupTmp().catch(() => {
      /* ignore */
    });
  }
}

/** Rasterize one PDF page with pdfjs + @napi-rs/canvas when pdftoppm is missing or too slow. */
async function renderPdfPagePdfjs(
  filePath: string,
  maxEdge: number,
  pageIndex: number,
): Promise<string> {
  installPdfjsNodeShim();
  const require = createRequire(import.meta.url);
  const { createCanvas } =
    require("@napi-rs/canvas") as typeof import("@napi-rs/canvas");
  const data = await fs.readFile(filePath);
  const pdfjs = await importPdfjsLegacy();
  const loadingTask = pdfjs.getDocument({
    ...getPdfjsNodeDocumentInit(),
    data: new Uint8Array(data),
    useSystemFonts: true,
  });
  const doc = await loadingTask.promise;
  try {
    const pageNum = Math.min(Math.max(pageIndex + 1, 1), doc.numPages);
    const page = await doc.getPage(pageNum);
    const baseVp = page.getViewport({ scale: 1 });
    const scale = maxEdge / Math.max(baseVp.width, baseVp.height);
    const viewport = page.getViewport({ scale });
    const w = Math.max(1, Math.floor(viewport.width));
    const h = Math.max(1, Math.floor(viewport.height));
    const canvas = createCanvas(w, h);
    const task = page.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      viewport,
    });
    await task.promise;
    const raw = canvas.toBuffer("image/png");
    const resized = await sharp(raw)
      .resize(maxEdge, maxEdge, { fit: "inside" })
      .png()
      .toBuffer();
    return resized.toString("base64");
  } finally {
    await doc.destroy().catch(() => {
      /* ignore */
    });
  }
}

async function renderPdfThumb(
  filePath: string,
  maxEdge: number,
  page: number,
): Promise<string> {
  try {
    return await renderPdfPdftoppm(filePath, maxEdge, page);
  } catch {
    return renderPdfPagePdfjs(filePath, maxEdge, page);
  }
}

export type ThumbnailArgs = { path: string; max_edge: number; page?: number };

export async function thumbnailImageBase64Png(args: ThumbnailArgs): Promise<{
  png_base64: string;
}> {
  const filePath = args.path;
  const maxEdge = Math.min(Math.max(args.max_edge, 48), 512);
  const page = args.page ?? 0;
  const st = await fs.stat(filePath);
  const mtimeMs = Math.trunc(st.mtimeMs);
  const sizeBytes = st.size;
  const ck = cacheKey(filePath, maxEdge, page);
  const fp = fingerprint(mtimeMs, sizeBytes);

  const hit = memCache.get(ck);
  if (hit && hit.mtimeMs === mtimeMs && hit.sizeBytes === sizeBytes) {
    return { png_base64: hit.pngBase64 };
  }

  try {
    const diskPath = await diskCachePath(ck, fp);
    const existing = await fs.readFile(diskPath, "utf8").catch(() => null);
    if (existing) {
      if (memCache.size >= THUMB_CACHE_MAX_ENTRIES) memCache.clear();
      memCache.set(ck, { mtimeMs, sizeBytes, pngBase64: existing });
      return { png_base64: existing };
    }
  } catch {
    // ignore disk cache errors
  }

  const ext = normalizeExt(path.extname(filePath).slice(1));
  const supported = ["png", "jpg", "jpeg", "pdf", "mp4", "mov"];
  if (!supported.includes(ext)) {
    throw new Error(`thumbnail unsupported file type: ${ext}`);
  }

  const run = async (): Promise<string> => {
    if (ext === "png" || ext === "jpg" || ext === "jpeg") {
      return renderImageThumb(filePath, maxEdge);
    }
    if (ext === "mp4" || ext === "mov") {
      return renderVideoThumb(filePath, maxEdge);
    }
    if (ext === "pdf") {
      return renderPdfThumb(filePath, maxEdge, page);
    }
    throw new Error(`thumbnail unsupported file type: ${ext}`);
  };

  const timeoutMs =
    ext === "pdf" ? THUMB_TIMEOUT_PDF_MS : THUMB_TIMEOUT_RASTER_MS;
  const pngBase64 = await Promise.race([
    run(),
    new Promise<string>((_, reject) =>
      setTimeout(
        () => reject(new Error("thumbnail render timed out")),
        timeoutMs,
      ),
    ),
  ]);

  if (memCache.size >= THUMB_CACHE_MAX_ENTRIES) memCache.clear();
  memCache.set(ck, { mtimeMs, sizeBytes, pngBase64 });
  try {
    const diskPath = await diskCachePath(ck, fp);
    await fs.writeFile(diskPath, pngBase64);
  } catch {
    // ignore
  }

  return { png_base64: pngBase64 };
}
