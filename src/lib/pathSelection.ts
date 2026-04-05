import type { LocalConfig } from "./localConfig";
import { pathHasDefaultExcludedSegment } from "./defaultFolderExcludes";

export function normalizePathForMatch(p: string) {
  return p.replace(/\\/g, "/").replace(/\/+$/, "");
}

export function isPathSelected(path: string, cfg: LocalConfig) {
  const p = normalizePathForMatch(path);
  const include = cfg.include.map(normalizePathForMatch).filter(Boolean);
  const exclude = cfg.exclude.map(normalizePathForMatch).filter(Boolean);
  const ext = (p.split(".").pop() ?? "").trim().toLowerCase();

  // No include roots means nothing is in scope (avoids showing stale tagged paths after all
  // folders are removed, and matches "only search inside selected folders").
  const inInclude =
    include.length > 0 && include.some((root) => p === root || p.startsWith(`${root}/`));
  const inUserExclude = exclude.some((root) => p === root || p.startsWith(`${root}/`));
  const inDefaultFolderExclude =
    cfg.useDefaultFolderExcludes && pathHasDefaultExcludedSegment(p);
  const extSelected = cfg.extensions.length === 0 || cfg.extensions.includes(ext);

  return inInclude && !inUserExclude && !inDefaultFolderExclude && extSelected;
}
