import { openPath } from "@tauri-apps/plugin-opener";
import { invokeErrorText } from "@/lib/errors";

export function fileExtension(path: string): string {
  return path.split(".").pop()?.trim().toLowerCase() ?? "";
}

export function fileTypeLabelFromPath(path: string): string {
  const ext = fileExtension(path).replace(/^\./, "").trim().toUpperCase();
  return ext || "FILE";
}

export function fileTypeLabel(ext: string): string {
  const cleanExt = ext.replace(/^\./, "").trim().toUpperCase();
  return cleanExt || "FILE";
}

export function fileNameFromPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  return normalized.split("/").pop() ?? path;
}

export async function openPathInDefaultApp(
  path: string,
): Promise<string | null> {
  try {
    await openPath(path);
    return null;
  } catch (error) {
    return invokeErrorText(error);
  }
}

export function formatSimilarityScore(score: number): string {
  if (score >= 0 && score <= 1) {
    return `${(score * 100).toFixed(1)}%`;
  }
  return score.toFixed(4);
}
