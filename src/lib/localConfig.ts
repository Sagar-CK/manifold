export type SupportedExt = string;

/** Maps to max JPEG edge + quality sent to Gemini for images (embed + OCR). */
export type EmbeddingImagePreset = "fast" | "balanced" | "highQuality";

type VisionRasterOptionsPayload = {
  maxEdgePx: number;
  jpegQuality: number;
};

export type LocalConfig = {
  sourceId: string;
  include: string[];
  exclude: string[];
  /** When true, skip common dependency/build/cache folder names (see defaultFolderExcludes.ts). Default true. */
  useDefaultFolderExcludes: boolean;
  extensions: SupportedExt[];
  scoreThreshold: number;
  searchMode: "topK" | "scoreThreshold";
  topK: number;
  showSimilarityOnHover: boolean;
  autoTaggingEnabled: boolean;
  /** Raster resize/compression before Gemini vision (embed + OCR). */
  embeddingImagePreset: EmbeddingImagePreset;
};

function normalizeFolderPath(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/\/+$/, "");
}

function isSameOrParentPath(
  candidateParent: string,
  candidateChild: string,
): boolean {
  const parent = normalizeFolderPath(candidateParent).toLowerCase();
  const child = normalizeFolderPath(candidateChild).toLowerCase();
  if (!parent || !child) return false;
  if (parent === child) return true;
  return child.startsWith(`${parent}/`);
}

export function collapseIncludeFolders(paths: string[]): string[] {
  const normalizedUnique: string[] = [];
  const seen = new Set<string>();
  for (const path of paths) {
    const normalized = normalizeFolderPath(path);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalizedUnique.push(normalized);
  }

  normalizedUnique.sort((a, b) => a.length - b.length || a.localeCompare(b));

  const collapsed: string[] = [];
  for (const path of normalizedUnique) {
    if (collapsed.some((existing) => isSameOrParentPath(existing, path))) {
      continue;
    }
    for (let i = collapsed.length - 1; i >= 0; i -= 1) {
      if (isSameOrParentPath(path, collapsed[i])) {
        collapsed.splice(i, 1);
      }
    }
    collapsed.push(path);
  }
  return collapsed;
}

const EMBEDDING_IMAGE_PRESETS: Record<
  EmbeddingImagePreset,
  VisionRasterOptionsPayload
> = {
  fast: { maxEdgePx: 768, jpegQuality: 72 },
  balanced: { maxEdgePx: 1536, jpegQuality: 85 },
  highQuality: { maxEdgePx: 1536, jpegQuality: 92 },
};

export function embeddingImageRasterOptions(
  preset: EmbeddingImagePreset,
): VisionRasterOptionsPayload {
  return EMBEDDING_IMAGE_PRESETS[preset];
}

export function createDefaultLocalConfig(): LocalConfig {
  return {
    sourceId: crypto.randomUUID(),
    include: [],
    exclude: [],
    useDefaultFolderExcludes: true,
    extensions: ["png", "jpg", "jpeg", "pdf"],
    scoreThreshold: 0.3,
    searchMode: "topK",
    topK: 10,
    showSimilarityOnHover: true,
    autoTaggingEnabled: true,
    embeddingImagePreset: "fast",
  };
}

export function normalizeLocalConfig(
  parsed?: Partial<LocalConfig>,
): LocalConfig {
  const defaults = createDefaultLocalConfig();
  return {
    ...defaults,
    ...parsed,
    sourceId: parsed?.sourceId ?? crypto.randomUUID(),
    include: collapseIncludeFolders(parsed?.include ?? []),
    exclude: parsed?.exclude ?? [],
    useDefaultFolderExcludes:
      typeof parsed?.useDefaultFolderExcludes === "boolean"
        ? parsed.useDefaultFolderExcludes
        : defaults.useDefaultFolderExcludes,
    extensions:
      (parsed?.extensions as SupportedExt[] | undefined) ?? defaults.extensions,
    scoreThreshold:
      typeof parsed?.scoreThreshold === "number"
        ? Math.max(0, Math.min(1, parsed.scoreThreshold))
        : defaults.scoreThreshold,
    searchMode:
      parsed?.searchMode === "scoreThreshold" || parsed?.searchMode === "topK"
        ? parsed.searchMode
        : defaults.searchMode,
    topK:
      typeof parsed?.topK === "number"
        ? Math.max(1, Math.min(256, Math.floor(parsed.topK)))
        : defaults.topK,
    showSimilarityOnHover:
      typeof parsed?.showSimilarityOnHover === "boolean"
        ? parsed.showSimilarityOnHover
        : defaults.showSimilarityOnHover,
    autoTaggingEnabled:
      typeof parsed?.autoTaggingEnabled === "boolean"
        ? parsed.autoTaggingEnabled
        : defaults.autoTaggingEnabled,
    embeddingImagePreset:
      parsed?.embeddingImagePreset === "fast" ||
      parsed?.embeddingImagePreset === "balanced" ||
      parsed?.embeddingImagePreset === "highQuality"
        ? parsed.embeddingImagePreset
        : defaults.embeddingImagePreset,
  };
}
