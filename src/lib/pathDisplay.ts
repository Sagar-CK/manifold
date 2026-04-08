function normalizePathSlashes(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/, "");
}

/** Tilde-abbreviate home (same idea as Settings path rows). */
export function formatPathForDisplay(path: string, homePath: string): string {
  const normalizedPath = normalizePathSlashes(path.trim());
  const normalizedHome = normalizePathSlashes(homePath.trim());
  if (!normalizedHome) return normalizedPath;

  if (normalizedPath.toLowerCase() === normalizedHome.toLowerCase()) {
    return "~";
  }
  const homePrefix = `${normalizedHome}/`;
  if (normalizedPath.toLowerCase().startsWith(homePrefix.toLowerCase())) {
    return `~/${normalizedPath.slice(homePrefix.length)}`;
  }
  return normalizedPath;
}

/**
 * Prefer a path relative to the longest matching include root; otherwise home tilde; otherwise absolute.
 */
export function formatIndexedPathForDisplay(
  absolutePath: string,
  homePath: string,
  includeRoots: string[],
): string {
  const p = normalizePathSlashes(absolutePath.trim());
  const roots = includeRoots
    .map((r) => normalizePathSlashes(r.trim()))
    .filter(Boolean);

  let bestLen = 0;
  let bestRoot = "";
  for (const root of roots) {
    const pl = p.toLowerCase();
    const rl = root.toLowerCase();
    const prefix = `${root}/`;
    if (pl === rl) {
      return ".";
    }
    if (pl.startsWith(prefix.toLowerCase()) && root.length > bestLen) {
      bestLen = root.length;
      bestRoot = root;
    }
  }
  if (bestRoot) {
    const rel = p.slice(bestRoot.length + 1);
    return rel || p;
  }
  return formatPathForDisplay(absolutePath, homePath);
}
