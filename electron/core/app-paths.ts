import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { app } from "electron";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Repo root (parent of /electron when running from dist-electron). */
export function repoRoot(): string {
  return path.join(__dirname, "..");
}

export function userDataDir(): string {
  return app.getPath("userData");
}

export function loadDotenv(): void {
  dotenv.config({ path: path.join(repoRoot(), ".env.local") });
  dotenv.config({ path: path.join(userDataDir(), ".env.local") });
}

export function qdrantBinaryCandidates(): string[] {
  const name = process.platform === "win32" ? "qdrant.exe" : "qdrant";
  const root = repoRoot();
  const out: string[] = [];
  if (process.resourcesPath) {
    out.push(path.join(process.resourcesPath, "resources", "qdrant", name));
    out.push(path.join(process.resourcesPath, "qdrant", name));
    out.push(path.join(process.resourcesPath, name));
  }
  const exeDir = app.getPath("exe");
  const dir = path.dirname(exeDir);
  out.push(path.join(dir, "qdrant", name));
  out.push(path.join(dir, name));
  out.push(path.join(root, "resources", "qdrant", name));
  out.push(path.join(root, "bin", "qdrant", name));
  return out;
}

export function ffmpegBinaryCandidates(tool: "ffmpeg" | "ffprobe"): string[] {
  const ext = process.platform === "win32" ? ".exe" : "";
  const name = `${tool}${ext}`;
  const root = repoRoot();
  const out: string[] = [];
  const envOverride = process.env.MANIFOLD_FFMPEG_DIR?.trim();
  if (envOverride) {
    out.push(path.join(envOverride, name));
  }
  if (process.resourcesPath) {
    out.push(path.join(process.resourcesPath, "resources", "ffmpeg", name));
    out.push(path.join(process.resourcesPath, "ffmpeg", name));
    out.push(path.join(process.resourcesPath, name));
  }
  const dir = path.dirname(app.getPath("exe"));
  out.push(path.join(dir, "ffmpeg", name));
  out.push(path.join(root, "resources", "ffmpeg", name));
  out.push(path.join(root, "bin", "ffmpeg", name));
  return out;
}

export function resolveFirstExisting(candidates: string[]): string | null {
  for (const p of candidates) {
    try {
      if (p && fs.existsSync(p)) return p;
    } catch {
      // ignore
    }
  }
  return null;
}
