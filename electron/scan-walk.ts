import { createHash } from "node:crypto";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { repoRoot } from "./app-paths.js";

export const MAX_EMBED_FILE_BYTES = 25 * 1024 * 1024;
export const SCAN_HASH_MAX_BYTES = 1024 * 1024 * 128;

export type ScanFilesArgs = {
  include: string[];
  exclude: string[];
  extensions: string[];
  useDefaultFolderExcludes?: boolean;
};

export type ScanWalkCandidate = {
  path: string;
  sizeBytes: number;
  mtimeMs: number;
  ext: string;
};

let defaultFolderExcludeSegments: string[] | null = null;

function loadDefaultFolderExcludes(): string[] {
  if (defaultFolderExcludeSegments) return defaultFolderExcludeSegments;
  const raw = fs.readFileSync(
    path.join(repoRoot(), "config/default-folder-excludes.json"),
    "utf8",
  );
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    defaultFolderExcludeSegments = [];
  } else {
    defaultFolderExcludeSegments = parsed.map((s) => String(s));
  }
  return defaultFolderExcludeSegments;
}

function pathHasDefaultExcludedSegmentStrict(filePath: string): boolean {
  const segs = loadDefaultFolderExcludes();
  const norm = filePath.split(path.sep);
  for (const part of norm) {
    if (segs.some((seg) => part.toLowerCase() === seg.toLowerCase())) {
      return true;
    }
  }
  return false;
}

export function normalizeExt(s: string): string {
  return s.trim().replace(/^\.+/, "").toLowerCase();
}

export function normalizePathKey(p: string): string {
  return path
    .normalize(p)
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .toLowerCase();
}

export function isUnderDir(filePath: string, dir: string): boolean {
  const f = path.resolve(filePath);
  const d = path.resolve(dir);
  if (f === d) return true;
  const rel = path.relative(d, f);
  return !rel.startsWith(`..${path.sep}`) && rel !== "..";
}

export function isPathExcluded(
  filePath: string,
  userExcludes: readonly string[],
  useDefaultFolderExcludes: boolean,
): boolean {
  for (const ex of userExcludes) {
    if (isUnderDir(filePath, ex)) return true;
  }
  return (
    useDefaultFolderExcludes && pathHasDefaultExcludedSegmentStrict(filePath)
  );
}

/** Avoid ERR_DIR_CLOSED if the handle is already closed (e.g. after abort). */
async function closeDirQuietly(dh: fs.Dir): Promise<void> {
  try {
    await dh.close();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ERR_DIR_CLOSED") return;
    throw err;
  }
}

async function* iterateFilesUnderRoots(
  roots: readonly string[],
  excludeDirs: readonly string[],
  useDefaultExcludes: boolean,
): AsyncGenerator<string, void, void> {
  for (const rootRaw of roots) {
    const root = path.normalize(rootRaw);
    try {
      await fsPromises.access(root, fs.constants.R_OK);
    } catch {
      continue;
    }
    const stack: string[] = [root];
    while (stack.length > 0) {
      const dir = stack.pop()!;
      let dh: fs.Dir;
      try {
        dh = await fsPromises.opendir(dir);
      } catch (err) {
        if (
          (err as NodeJS.ErrnoException).code === "EACCES" ||
          (err as NodeJS.ErrnoException).code === "EPERM"
        ) {
          continue;
        }
        continue;
      }
      // Do not use `for await...of` on `fs.Dir` here: this function is an async
      // generator that `yield`s, and combining that with Dir's async iterator
      // can call `Dir.close` twice → ERR_DIR_CLOSED. `read()` + one `close()` is stable.
      try {
        for (;;) {
          const ent = await dh.read();
          if (ent === null) break;
          const full = path.join(dir, ent.name);
          let isLink = false;
          try {
            const lst = await fsPromises.lstat(full);
            isLink = lst.isSymbolicLink();
          } catch {
            continue;
          }
          if (isLink) continue;
          if (ent.isDirectory()) {
            if (isPathExcluded(full, excludeDirs, useDefaultExcludes)) {
              continue;
            }
            stack.push(full);
          } else if (ent.isFile()) {
            yield full;
          }
        }
      } finally {
        await closeDirQuietly(dh);
      }
    }
  }
}

export async function walkScanCandidates(
  args: ScanFilesArgs,
  maxFileBytes: number,
): Promise<ScanWalkCandidate[]> {
  const useDefault = args.useDefaultFolderExcludes !== false;
  const excludeDirs = args.exclude.map((e) => path.normalize(e));
  const allowed = new Set(args.extensions.map((e) => normalizeExt(e)));
  const out: ScanWalkCandidate[] = [];
  const seen = new Set<string>();
  const includes = args.include.map((p) => path.normalize(p));

  for await (const filePath of iterateFilesUnderRoots(
    includes,
    excludeDirs,
    useDefault,
  )) {
    if (isPathExcluded(filePath, excludeDirs, useDefault)) continue;
    const key = normalizePathKey(filePath);
    if (seen.has(key)) continue;
    seen.add(key);
    const extRaw = path.extname(filePath).slice(1);
    const ext = normalizeExt(extRaw || "");
    if (!ext) continue;
    if (allowed.size > 0 && !allowed.has(ext)) continue;
    let st: Awaited<ReturnType<typeof fsPromises.stat>>;
    try {
      st = await fsPromises.stat(filePath);
    } catch {
      continue;
    }
    if (!st.isFile() || st.size > maxFileBytes) continue;
    out.push({
      path: filePath,
      sizeBytes: st.size,
      mtimeMs: Math.trunc(st.mtimeMs),
      ext,
    });
  }
  return out;
}

export async function computeSha256(
  filePath: string,
  maxBytes: number,
): Promise<string> {
  const h = createHash("sha256");
  const fh = await fsPromises.open(filePath, "r");
  try {
    const buf = Buffer.allocUnsafe(1024 * 1024);
    let readTotal = 0;
    for (;;) {
      const { bytesRead } = await fh.read(buf, 0, buf.length, null);
      if (bytesRead === 0) break;
      readTotal += bytesRead;
      if (readTotal > maxBytes) {
        throw new Error(
          `File too large to hash (>${maxBytes} bytes): ${filePath}`,
        );
      }
      h.update(buf.subarray(0, bytesRead));
    }
    return h.digest("hex");
  } finally {
    await fh.close();
  }
}
