import { toast } from "sonner";
import { TagDefLabel } from "@/components/TagDefBadge";
import {
  geminiJudgeTag,
  qdrantSetPathTagIds,
  qdrantSimilarByPath,
} from "@/lib/api/desktop";
import {
  embeddingImageRasterOptions,
  type LocalConfig,
} from "@/lib/localConfig";
import { autoTagLog, formatError } from "@/lib/log";
import { isPathSelected } from "@/lib/pathSelection";
import { getTagSnapshot, setTagSnapshot } from "@/lib/stores/tagStore";
import type { TagDef } from "@/lib/tags";
import {
  acceptAllPendingForTag,
  acceptPendingAutoTag,
  countPendingSuggestionPairs,
  createTagDef,
  mergePendingAutoTagBatch,
  normalizePathKey,
  pendingTagIdsForPath,
  rejectAllPendingForTag,
  rejectPendingAutoTag,
  removeTagEverywhere,
  tagIdsForPath,
  togglePathTag,
} from "@/lib/tags";

type NavigateToReviewTags = (() => void) | undefined;

function AutoTagLoadingToast({ tag }: { tag: TagDef }) {
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-1.5 text-xs/relaxed text-muted-foreground">
      <span>Finding similar files for</span>
      <TagDefLabel tag={tag} />
    </span>
  );
}

function AutoTagReviewToast({ tag, count }: { tag: TagDef; count: number }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <TagDefLabel tag={tag} />
      <p className="text-xs/relaxed text-muted-foreground">
        {count} {count === 1 ? "suggestion" : "suggestions"} to review
      </p>
    </div>
  );
}

async function syncPathTagIds(sourceId: string, path: string): Promise<void> {
  const snapshot = getTagSnapshot();
  await qdrantSetPathTagIds(sourceId, path, tagIdsForPath(snapshot, path));
}

async function runAutoTagSuggestions(
  cfg: LocalConfig,
  sourcePath: string,
  tagId: string,
  navigateToReviewTags?: NavigateToReviewTags,
): Promise<void> {
  const tagState = getTagSnapshot();
  const tagDef = tagState.tags.find((tag) => tag.id === tagId);
  if (!tagDef) {
    return;
  }

  const toastId = toast.loading(<AutoTagLoadingToast tag={tagDef} />);

  try {
    const rawHits = await qdrantSimilarByPath(
      cfg.sourceId,
      sourcePath,
      cfg.topK,
    );
    const hits = rawHits
      .filter((hit) => isPathSelected(hit.file.path, cfg))
      .slice(0, cfg.topK);

    const visionRaster = embeddingImageRasterOptions(cfg.embeddingImagePreset);
    const matchedPaths = await Promise.all(
      hits.map(async (hit) => {
        if (hit.file.path === sourcePath) {
          return null;
        }

        const snapshot = getTagSnapshot();
        if (tagIdsForPath(snapshot, hit.file.path).includes(tagId)) {
          return null;
        }
        if (pendingTagIdsForPath(snapshot, hit.file.path).includes(tagId)) {
          return null;
        }

        try {
          const isMatch = await geminiJudgeTag({
            sourceId: cfg.sourceId,
            sourcePath,
            targetPath: hit.file.path,
            tagName: tagDef.name,
            similarityScore: hit.score,
            visionRaster,
          });
          return isMatch ? hit.file.path : null;
        } catch (error) {
          autoTagLog.error("judge failed", {
            labeled: sourcePath,
            candidate: hit.file.path,
            error: formatError(error),
          });
          return null;
        }
      }),
    );

    toast.dismiss(toastId);

    const normalizedSeen = new Set<string>();
    const deduped = matchedPaths.flatMap((path) => {
      if (!path) {
        return [];
      }
      const key = normalizePathKey(path);
      if (normalizedSeen.has(key)) {
        return [];
      }
      normalizedSeen.add(key);
      return [path];
    });

    const base = getTagSnapshot();
    const filtered = deduped.filter((path) => {
      if (normalizePathKey(path) === normalizePathKey(sourcePath)) {
        return false;
      }
      if (tagIdsForPath(base, path).includes(tagId)) {
        return false;
      }
      if (pendingTagIdsForPath(base, path).includes(tagId)) {
        return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      return;
    }

    const next = mergePendingAutoTagBatch(base, filtered, tagId);
    setTagSnapshot(next);

    const totalPending = countPendingSuggestionPairs(next);
    toast.success(<AutoTagReviewToast tag={tagDef} count={totalPending} />, {
      id: `auto-tag-${sourcePath}-${tagId}`,
      classNames: {
        toast: "!w-[min(100vw-2rem,18rem)]",
      },
      ...(navigateToReviewTags
        ? {
            action: {
              label: "Review",
              onClick: navigateToReviewTags,
            },
          }
        : {}),
    });
  } catch (error) {
    autoTagLog.error("Auto-tagging failed", { error: formatError(error) });
    toast.error(`Auto-tagging failed: ${String(error)}`, { id: toastId });
  }
}

export async function toggleTagForPath(params: {
  path: string;
  tagId: string;
  sourceId: string;
  cfg?: LocalConfig;
  navigateToReviewTags?: NavigateToReviewTags;
}): Promise<void> {
  const { path, tagId, sourceId, cfg, navigateToReviewTags } = params;
  const next = togglePathTag(getTagSnapshot(), path, tagId);
  setTagSnapshot(next);

  void syncPathTagIds(sourceId, path).catch(() => {
    /* ignore offline qdrant errors */
  });

  if (cfg?.autoTaggingEnabled && tagIdsForPath(next, path).includes(tagId)) {
    await runAutoTagSuggestions(cfg, path, tagId, navigateToReviewTags);
  }
}

export function createTagDefinition(name: string, color: string): void {
  const next = getTagSnapshot();
  setTagSnapshot({ ...next, tags: [...next.tags, createTagDef(name, color)] });
}

export function removeTagDefinition(tagId: string, sourceId: string): void {
  const snapshot = getTagSnapshot();
  const affectedPaths = Object.entries(snapshot.pathToTagIds)
    .filter(([, ids]) => ids.includes(tagId))
    .map(([path]) => path);

  const next = removeTagEverywhere(snapshot, tagId);
  setTagSnapshot(next);

  for (const path of affectedPaths) {
    void syncPathTagIds(sourceId, path).catch(() => {
      /* ignore offline qdrant errors */
    });
  }
}

export function acceptPendingTag(
  path: string,
  tagId: string,
  sourceId: string,
): void {
  const next = acceptPendingAutoTag(getTagSnapshot(), path, tagId);
  setTagSnapshot(next);
  void syncPathTagIds(sourceId, path).catch(() => {
    /* ignore offline qdrant errors */
  });
}

export function rejectPendingTag(path: string, tagId: string): void {
  setTagSnapshot((prev) => rejectPendingAutoTag(prev, path, tagId));
}

export function acceptAllPendingTagsForTag(
  tagId: string,
  sourceId: string,
): void {
  const snapshot = getTagSnapshot();
  const affectedPaths = Object.keys(snapshot.pendingAutoTags).filter((path) =>
    snapshot.pendingAutoTags[path]?.includes(tagId),
  );
  const next = acceptAllPendingForTag(snapshot, tagId);
  setTagSnapshot(next);

  for (const path of affectedPaths) {
    void syncPathTagIds(sourceId, path).catch(() => {
      /* ignore offline qdrant errors */
    });
  }
}

export function rejectAllPendingTagsForTag(tagId: string): void {
  setTagSnapshot((prev) => rejectAllPendingForTag(prev, tagId));
}
