/**
 * Directory name segments to skip when `useDefaultFolderExcludes` is true.
 * Keep in sync with `default_folder_exclude_segments()` in `src-tauri/src/lib.rs`.
 */
export const DEFAULT_FOLDER_EXCLUDE_SEGMENTS: readonly string[] = [
  ".bzr",
  ".cache",
  ".eslintcache",
  ".fseventsd",
  ".git",
  ".gradle",
  ".hg",
  ".mypy_cache",
  ".next",
  ".nuget",
  ".nuxt",
  ".nyc_output",
  ".output",
  ".parcel-cache",
  ".pytest_cache",
  ".ruff_cache",
  ".Spotlight-V100",
  ".svn",
  ".svelte-kit",
  ".TemporaryItems",
  ".Trash",
  ".turbo",
  ".venv",
  "__pycache__",
  "bin",
  "bower_components",
  "build",
  "Carthage",
  "coverage",
  "DerivedData",
  "dist",
  "env",
  "htmlcov",
  "jspm_packages",
  "node_modules",
  "obj",
  "out",
  "Pods",
  "target",
  "venv",
  "virtualenv",
];

const segmentSet = new Set(
  DEFAULT_FOLDER_EXCLUDE_SEGMENTS.map((s) => s.toLowerCase()),
);

/**
 * True if any path component (directory name) matches the built-in exclude list (ASCII case-insensitive).
 */
export function pathHasDefaultExcludedSegment(path: string): boolean {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  for (const segment of normalized.split("/")) {
    if (!segment) continue;
    if (segmentSet.has(segment.toLowerCase())) {
      return true;
    }
  }
  return false;
}
