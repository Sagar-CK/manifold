export type SupportedExt = "png" | "jpg" | "jpeg" | "mp3" | "wav" | "mp4" | "mov" | "pdf";

export type LocalConfig = {
  sourceId: string;
  include: string[];
  exclude: string[];
  extensions: SupportedExt[];
  scoreThreshold: number;
};

const KEY = "manifold:config:v1";

function defaultConfig(): LocalConfig {
  return {
    sourceId: crypto.randomUUID(),
    include: [],
    exclude: [],
    extensions: ["png", "jpg", "jpeg", "pdf", "mp3", "wav", "mp4", "mov"],
    scoreThreshold: 0,
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
      include: parsed.include ?? [],
      exclude: parsed.exclude ?? [],
      extensions: (parsed.extensions as SupportedExt[] | undefined) ?? defaultConfig().extensions,
      scoreThreshold:
        typeof parsed.scoreThreshold === "number"
          ? Math.max(0, Math.min(1, parsed.scoreThreshold))
          : defaultConfig().scoreThreshold,
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
  localStorage.setItem(KEY, JSON.stringify(cfg));
}

