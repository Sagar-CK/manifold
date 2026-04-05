import { invoke } from "@tauri-apps/api/core";

/** Push tag membership for one path to both Qdrant collections (content + metadata). */
export async function syncPathTagsToQdrant(
  sourceId: string,
  path: string,
  tagIds: string[],
): Promise<void> {
  await invoke("qdrant_set_path_tag_ids", {
    args: { sourceId, path, tagIds },
  });
}

/** Batch backfill path → tag ids (e.g. migration from localStorage-only tags). */
export async function syncTagsBackfill(
  sourceId: string,
  entries: { path: string; tagIds: string[] }[],
): Promise<number> {
  return await invoke<number>("qdrant_sync_tags_backfill", {
    args: { sourceId, entries },
  });
}
