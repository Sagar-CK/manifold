import defaultFolderExcludeSegments from "../../../config/default-folder-excludes.json";

const DEFAULT_FOLDER_EXCLUDE_SEGMENTS: readonly string[] =
  defaultFolderExcludeSegments;

/**
 * True if any path component (directory name) matches the built-in exclude list (ASCII case-insensitive).
 */
export function pathHasDefaultExcludedSegment(
  path: string,
  segments: readonly string[] = DEFAULT_FOLDER_EXCLUDE_SEGMENTS,
): boolean {
  const segmentSet = new Set(segments.map((s) => s.toLowerCase()));
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  for (const segment of normalized.split("/")) {
    if (!segment) continue;
    if (segmentSet.has(segment.toLowerCase())) {
      return true;
    }
  }
  return false;
}
