export type SupportedExt = string;

export type LocalConfig = {
  sourceId: string;
  include: string[];
  exclude: string[];
  extensions: SupportedExt[];
  scoreThreshold: number;
  searchMode: "topK" | "scoreThreshold";
  topK: number;
};

const KEY = "manifold:config:v1";

function normalizeFolderPath(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/\/+$/, "");
}

function isSameOrParentPath(candidateParent: string, candidateChild: string): boolean {
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

function defaultConfig(): LocalConfig {
  return {
    sourceId: crypto.randomUUID(),
    include: [],
    exclude: [],
    extensions: ["png", "jpg", "jpeg", "pdf", "mp3", "wav", "mp4", "mov"],
    scoreThreshold: 0,
    searchMode: "topK",
    topK: 24,
  };
}

export function loadConfig(): LocalConfig {
  const raw = localStorage.getItem(KEY);
  if (!raw) {
    const cfg = defaultConfig();
    saveConfig(cfg);
    return cfg;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<LocalConfig>;
    const cfg: LocalConfig = {
      ...defaultConfig(),
      ...parsed,
      sourceId: parsed.sourceId ?? crypto.randomUUID(),
      include: collapseIncludeFolders(parsed.include ?? []),
      exclude: parsed.exclude ?? [],
      extensions: (parsed.extensions as SupportedExt[] | undefined) ?? defaultConfig().extensions,
      scoreThreshold:
        typeof parsed.scoreThreshold === "number"
          ? Math.max(0, Math.min(1, parsed.scoreThreshold))
          : defaultConfig().scoreThreshold,
      searchMode:
        parsed.searchMode === "scoreThreshold" || parsed.searchMode === "topK"
          ? parsed.searchMode
          : defaultConfig().searchMode,
      topK:
        typeof parsed.topK === "number"
          ? Math.max(1, Math.min(256, Math.floor(parsed.topK)))
          : defaultConfig().topK,
    };
    saveConfig(cfg);
    return cfg;
  } catch {
    const cfg = defaultConfig();
    saveConfig(cfg);
    return cfg;
  }
}

export function saveConfig(cfg: LocalConfig) {
  localStorage.setItem(
    KEY,
    JSON.stringify({
      ...cfg,
      include: collapseIncludeFolders(cfg.include),
    }),
  );
}

