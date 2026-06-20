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

export type PathDisplayParts = {
  /** Tilde-abbreviated full path for tooltips. */
  display: string;
  /** Primary row label (folder name). */
  name: string;
  /** Parent path when nested; null for top-level. */
  parent: string | null;
};

/** Split a path into a compact list-row label and optional parent hint. */
export function formatPathPartsForDisplay(
  path: string,
  homePath: string,
): PathDisplayParts {
  const display = formatPathForDisplay(path, homePath);

  if (display === "~") {
    return { display, name: "Home", parent: null };
  }

  if (display.startsWith("~/")) {
    const rel = display.slice(2);
    const parts = rel.split("/").filter(Boolean);
    if (parts.length === 0) {
      return { display, name: "Home", parent: null };
    }
    if (parts.length === 1) {
      return { display, name: parts[0], parent: "~" };
    }
    return {
      display,
      name: parts[parts.length - 1],
      parent: `~/${parts.slice(0, -1).join("/")}`,
    };
  }

  const parts = display.split("/").filter(Boolean);
  if (parts.length <= 1) {
    return { display, name: parts[0] ?? display, parent: null };
  }

  const parent = display.startsWith("/")
    ? `/${parts.slice(0, -1).join("/")}`
    : parts.slice(0, -1).join("/");

  return {
    display,
    name: parts[parts.length - 1],
    parent,
  };
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
