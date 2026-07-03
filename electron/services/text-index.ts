import fs from "node:fs/promises";
import path from "node:path";
import { normalizeForMatch } from "../../src/lib/search/textMatchNormalize.ts";

export const INDEX_FILE_NAME = "text_index_v1.json";

export { normalizeForMatch };

export type UpsertTextArgs = {
  sourceId: string;
  path: string;
  contentHash: string;
  rawText: string;
  /** Normalized filename + PDF page text (not Gemini vision OCR). */
  normalizedPathPdf?: string;
  /** Normalized Gemini vision OCR text only. */
  normalizedOcr?: string;
};

export type SearchTextArgs = {
  sourceId: string;
  query: string;
  limit?: number;
  includeText?: boolean;
  includeOcr?: boolean;
};

export type TextSearchHit = {
  path: string;
  contentHash: string;
  matchType: "text" | "ocr";
};

type IndexEntry = {
  sourceId: string;
  path: string;
  contentHash: string;
  rawText: string;
  normalizedText: string;
  normalizedPathPdf?: string;
  normalizedOcr?: string;
};

function migrateEntry(e: IndexEntry): IndexEntry {
  if (e.normalizedPathPdf !== undefined || e.normalizedOcr !== undefined) {
    return e;
  }
  return {
    ...e,
    normalizedPathPdf: e.normalizedText,
    normalizedOcr: "",
  };
}

function termsMatch(norm: string, queryTerms: readonly string[]): boolean {
  if (!norm.trim()) return false;
  const words = new Set(norm.split(/\s+/).filter(Boolean));
  if (queryTerms.every((q) => words.has(q))) return true;

  const compactNorm = norm.replace(/\s+/g, "");
  const compactQuery = queryTerms.join("");
  return compactQuery.length > 0 && compactNorm.includes(compactQuery);
}

async function resolvedIndexPath(userDataDir: string): Promise<string> {
  await fs.mkdir(userDataDir, { recursive: true });
  return path.join(userDataDir, INDEX_FILE_NAME);
}

export class TextIndexState {
  private entries: IndexEntry[] | null = null;

  private async ensureLoaded(userDataDir: string): Promise<void> {
    if (this.entries !== null) return;
    const p = await resolvedIndexPath(userDataDir);
    try {
      const raw = await fs.readFile(p, "utf8");
      if (raw.trim() === "") {
        this.entries = [];
        return;
      }
      const parsed = JSON.parse(raw) as IndexEntry[];
      const arr = Array.isArray(parsed) ? parsed : [];
      this.entries = arr.map((e) => migrateEntry(e));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        this.entries = [];
        return;
      }
      throw new Error(`failed to read text index: ${String(e)}`);
    }
  }

  private async saveEntries(userDataDir: string): Promise<void> {
    const entries = this.entries;
    if (!entries) throw new Error("text index not loaded");
    const p = await resolvedIndexPath(userDataDir);
    await fs.writeFile(p, JSON.stringify(entries), "utf8");
  }

  async upsertText(userDataDir: string, args: UpsertTextArgs): Promise<void> {
    await this.ensureLoaded(userDataDir);
    const next = this.entries!.filter(
      (e) => !(e.sourceId === args.sourceId && e.path === args.path),
    );
    const fullNorm = normalizeForMatch(args.rawText);
    const pathPdfNorm =
      args.normalizedPathPdf !== undefined ? args.normalizedPathPdf : fullNorm;
    const ocrNorm = args.normalizedOcr !== undefined ? args.normalizedOcr : "";
    next.push({
      sourceId: args.sourceId,
      path: args.path,
      contentHash: args.contentHash,
      rawText: args.rawText,
      normalizedText: fullNorm,
      normalizedPathPdf: pathPdfNorm,
      normalizedOcr: ocrNorm,
    });
    this.entries = next;
    await this.saveEntries(userDataDir);
  }

  async getFullTextForPath(
    userDataDir: string,
    sourceId: string,
    filePath: string,
  ): Promise<string | undefined> {
    await this.ensureLoaded(userDataDir);
    const e = this.entries!.find(
      (x) => x.sourceId === sourceId && x.path === filePath,
    );
    if (!e) return undefined;
    return e.rawText.length === 0 ? e.normalizedText : e.rawText;
  }

  async deleteAllForSource(
    userDataDir: string,
    sourceId: string,
  ): Promise<void> {
    await this.ensureLoaded(userDataDir);
    this.entries = this.entries!.filter((e) => e.sourceId !== sourceId);
    await this.saveEntries(userDataDir);
  }

  async deleteForPaths(
    userDataDir: string,
    sourceId: string,
    pathsToRemove: readonly string[],
  ): Promise<void> {
    await this.ensureLoaded(userDataDir);
    const set = new Set(pathsToRemove);
    this.entries = this.entries!.filter(
      (e) => !(e.sourceId === sourceId && set.has(e.path)),
    );
    await this.saveEntries(userDataDir);
  }

  async deleteForPathsUnderInclude(
    userDataDir: string,
    sourceId: string,
    includeRoot: string,
  ): Promise<void> {
    await this.ensureLoaded(userDataDir);
    this.entries = this.entries!.filter((e) => {
      if (e.sourceId !== sourceId) return true;
      return !isUnderDir(e.path, includeRoot);
    });
    await this.saveEntries(userDataDir);
  }

  async searchText(
    userDataDir: string,
    args: SearchTextArgs,
  ): Promise<TextSearchHit[]> {
    await this.ensureLoaded(userDataDir);
    const includeText = args.includeText !== false;
    const includeOcr = args.includeOcr !== false;
    if (!includeText && !includeOcr) return [];

    const normalizedQuery = normalizeForMatch(args.query);
    if (normalizedQuery === "") return [];
    const queryTerms = normalizedQuery.split(/\s+/).filter((t) => t.length > 0);
    if (queryTerms.length === 0) return [];
    const limit = Math.min(Math.max(args.limit ?? 32, 1), 256);
    const out: TextSearchHit[] = [];

    for (const raw of this.entries!) {
      if (raw.sourceId !== args.sourceId) continue;
      const entry = migrateEntry(raw);
      const pathPdf = entry.normalizedPathPdf ?? entry.normalizedText;
      const ocr = entry.normalizedOcr ?? "";
      const textOk = includeText && termsMatch(pathPdf, queryTerms);
      const ocrOk = includeOcr && termsMatch(ocr, queryTerms);
      if (!textOk && !ocrOk) continue;
      const matchType: "text" | "ocr" = ocrOk && includeOcr ? "ocr" : "text";
      out.push({
        path: entry.path,
        contentHash: entry.contentHash,
        matchType,
      });
      if (out.length >= limit) break;
    }
    return out;
  }
}

export function isUnderDir(filePath: string, dir: string): boolean {
  const f = path.resolve(filePath);
  const d = path.resolve(dir);
  if (f === d) return true;
  const rel = path.relative(d, f);
  return !rel.startsWith(`..${path.sep}`) && rel !== "..";
}
