import defaultFolderExcludeSegments from "../../shared/default-folder-excludes.json";

export const DEFAULT_FOLDER_EXCLUDE_SEGMENTS: readonly string[] =
  defaultFolderExcludeSegments;

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
