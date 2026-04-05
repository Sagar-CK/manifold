import type { Dispatch, SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { TagDefLabel } from "@/components/TagDefBadge";
import { embeddingImageRasterOptions, type LocalConfig } from "@/lib/localConfig";
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
import { autoTagLog, formatError } from "@/lib/log";

type AutoTagHit = {
  file: { path: string };
  score: number;
};

let _navigateToReviewTags: () => void = () => {};

export function setNavigateToReviewTagsCallback(cb: () => void) {
  _navigateToReviewTags = cb;
}

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
    const rawHits = await invoke<AutoTagHit[]>("qdrant_similar_by_path", {
      args: { sourceId: cfg.sourceId, path: sourcePath, limit: cfg.topK },
    });

    const hits = rawHits
      .filter((h) => isPathSelected(h.file.path, cfg))
      .slice(0, cfg.topK);

    const matchedPaths: string[] = [];
    const visionRaster = embeddingImageRasterOptions(cfg.embeddingImagePreset);

    const promises = hits.map(async (hit) => {
      if (hit.file.path === sourcePath) {
        return;
      }
      if (tagIdsForPath(tagsState, hit.file.path).includes(tagId)) {
        return;
      }
      if (pendingTagIdsForPath(tagsState, hit.file.path).includes(tagId)) {
        return;
      }

      try {
        const isMatch = await invoke<boolean>("gemini_judge_tag", {
          args: {
            sourceId: cfg.sourceId,
            sourcePath,
            targetPath: hit.file.path,
            tagName: tagDef.name,
            similarityScore: hit.score,
            visionRaster: {
              maxEdgePx: visionRaster.maxEdgePx,
              jpegQuality: visionRaster.jpegQuality,
            },
          },
        });

        if (isMatch) {
          matchedPaths.push(hit.file.path);
        }
      } catch (err) {
        autoTagLog.error("judge failed", {
          labeled: sourcePath,
          candidate: hit.file.path,
          error: formatError(err),
        });
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
    autoTagLog.error("Auto-tagging failed", { error: formatError(e) });
    toast.error(`Auto-tagging failed: ${String(e)}`, { id: toastId });
  }
}
