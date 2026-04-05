import type { Dispatch, SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { TagDefLabel } from "@/components/TagDefBadge";
import type { LocalConfig } from "@/lib/localConfig";
import { isPathSelected } from "@/lib/pathSelection";
import {
  countPendingSuggestionPairs,
  loadTagsState,
  mergePendingAutoTagBatch,
  normalizePathKey,
  pendingTagIdsForPath,
  saveTagsState,
  tagIdsForPath,
  type TagsState,
} from "./tags";

// Redefining a minimal version for our needs
type AutoTagHit = {
  file: { path: string };
  score: number;
};

let _navigateToReviewTags: () => void = () => {};

/** Registered from the app shell so auto-tag toasts can open the review page. */
export function setNavigateToReviewTagsCallback(cb: () => void) {
  _navigateToReviewTags = cb;
}

/** Max neighbors to judge; must stay within `qdrant_similar_by_path` clamp (64) after path scoping. */
const AUTO_TAG_JUDGE_LIMIT = 25;

export async function runAutoTagOrchestration(
  cfg: LocalConfig,
  sourcePath: string,
  tagId: string,
  tagsState: TagsState,
  setTagsState: Dispatch<SetStateAction<TagsState>>,
) {
  const tagDef = tagsState.tags.find((t) => t.id === tagId);
  if (!tagDef) {
    return;
  }

  const toastId = toast.loading(
    <span className="inline-flex items-center gap-1.5 flex-wrap">
      <span>Finding similar files for</span>
      <TagDefLabel tag={tagDef} />
    </span>,
  );

  try {
    // Fetch the max Qdrant allows, then keep neighbors that match the same include/exclude rules as
    // the file overview "Similar" list (`FileResultPage` uses `isPathSelected`). Otherwise auto-tag
    // judges the global top N for the whole index — often a different set than the UI.
    const rawHits = (await invoke("qdrant_similar_by_path", {
      args: { sourceId: cfg.sourceId, path: sourcePath, limit: 64 },
    })) as AutoTagHit[];

    const hits = rawHits
      .filter((h) => isPathSelected(h.file.path, cfg))
      .slice(0, AUTO_TAG_JUDGE_LIMIT);

    const matchedPaths: string[] = [];

    const promises = hits.map(async (hit) => {
      // Skip if it's the exact same file
      if (hit.file.path === sourcePath) {
        return;
      }

      // Skip if already confirmed or already pending for this tag (other pending tags are OK).
      if (tagIdsForPath(tagsState, hit.file.path).includes(tagId)) {
        return;
      }
      if (pendingTagIdsForPath(tagsState, hit.file.path).includes(tagId)) {
        return;
      }

      console.log(`[AutoTag] labeled='${sourcePath}' candidate='${hit.file.path}'`);
      try {
        const isMatch = await invoke<boolean>("gemini_judge_tag", {
          args: {
            sourceId: cfg.sourceId,
            sourcePath,
            targetPath: hit.file.path,
            tagName: tagDef.name,
            similarityScore: hit.score,
          },
        });

        if (isMatch) {
          matchedPaths.push(hit.file.path);
        }
      } catch (err) {
        console.error(
          `[AutoTag] judge failed labeled='${sourcePath}' candidate='${hit.file.path}'`,
          err,
        );
      }
    });

    await Promise.all(promises);

    toast.dismiss(toastId);

    const normalizedSeen = new Set<string>();
    const deduped: string[] = [];
    for (const path of matchedPaths) {
      const k = normalizePathKey(path);
      if (normalizedSeen.has(k)) continue;
      normalizedSeen.add(k);
      deduped.push(path);
    }

    const base = loadTagsState();
    const filtered = deduped.filter((path) => {
      if (normalizePathKey(path) === normalizePathKey(sourcePath)) return false;
      if (tagIdsForPath(base, path).includes(tagId)) return false;
      if (pendingTagIdsForPath(base, path).includes(tagId)) return false;
      return true;
    });

    if (filtered.length === 0) {
      return;
    }

    const next = mergePendingAutoTagBatch(base, filtered, tagId);
    const totalPending = countPendingSuggestionPairs(next);
    saveTagsState(next);
    setTagsState(next);

    const uniqueToastId = `auto-tag-${sourcePath}-${tagId}`;
    toast.success(
      <span className="inline-flex items-center gap-1.5 flex-wrap">
        <TagDefLabel tag={tagDef} />
        <span>
          {totalPending}{" "}
          {totalPending === 1 ? "suggestion" : "suggestions"} to review.
        </span>
      </span>,
      {
        id: uniqueToastId,
        action: {
          label: "Review",
          onClick: () => {
            _navigateToReviewTags();
          },
        },
      },
    );
  } catch (e) {
    console.error("[AutoTag] Auto-tagging failed:", e);
    toast.error(`Auto-tagging failed: ${String(e)}`, { id: toastId });
  }
}
