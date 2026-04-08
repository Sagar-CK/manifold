import {
  pruneMissingIndexedPaths,
  qdrantDeletePointsForPaths,
} from "@/lib/api/tauri";
import { invokeErrorText } from "@/lib/errors";
import { setTagSnapshot } from "@/lib/stores/tagStore";
import { removePathEverywhere } from "@/lib/tags";

const pendingDeletes = new Set<string>();

function isMissingFileError(error: unknown): boolean {
  const message = invokeErrorText(error).toLowerCase();
  return (
    message.includes("no such file") ||
    message.includes("not found") ||
    message.includes("cannot find the file")
  );
}

export async function pruneIndexedPathIfMissing(
  sourceId: string,
  path: string,
  error: unknown,
): Promise<boolean> {
  if (!isMissingFileError(error)) return false;

  const key = `${sourceId}\0${path}`;
  if (pendingDeletes.has(key)) return true;

  pendingDeletes.add(key);
  try {
    setTagSnapshot((prev) => removePathEverywhere(prev, path));
    await qdrantDeletePointsForPaths(sourceId, [path]);
    return true;
  } finally {
    pendingDeletes.delete(key);
  }
}

export async function pruneMissingIndexedPathsFromList(
  sourceId: string,
  paths: string[],
): Promise<string[]> {
  const removedPaths = await pruneMissingIndexedPaths(sourceId, paths);
  if (removedPaths.length === 0) {
    return removedPaths;
  }
  const removedSet = new Set(removedPaths);
  setTagSnapshot((prev) => {
    let next = prev;
    for (const path of removedSet) {
      next = removePathEverywhere(next, path);
    }
    return next;
  });
  return removedPaths;
}
