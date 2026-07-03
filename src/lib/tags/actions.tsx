import { toast } from "sonner";
import { TagDefLabel } from "@/components/tags/TagDefBadge";
import {
  geminiJudgeTag,
  qdrantSetPathTagIds,
  qdrantSimilarByPath,
} from "@/lib/api/desktop";
import {
  embeddingImageRasterOptions,
  type LocalConfig,
} from "@/lib/config/localConfig";
import { isPathSelected } from "@/lib/files/pathSelection";
import { autoTagLog, formatError } from "@/lib/log";
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
const MANUAL_SUGGESTION_BATCH_SIZE = 6;
const MANUAL_SUGGESTION_MIN_CANDIDATES = 64;
const MANUAL_SUGGESTION_DEPTH_PER_PENDING = 16;

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
    <div className="flex min-w-0 items-center gap-1.5 text-xs/relaxed text-popover-foreground">
      <span className="tabular-nums">{count}</span>
      <TagDefLabel tag={tag} />
      <span>{count === 1 ? "suggested file." : "suggested files."}</span>
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
  showLoadingToast = true,
  candidateLimit = cfg.topK,
  maxNewSuggestions = Number.POSITIVE_INFINITY,
): Promise<number> {
  const tagState = getTagSnapshot();
  const tagDef = tagState.tags.find((tag) => tag.id === tagId);
  if (!tagDef) {
    return 0;
  }

  const toastId = showLoadingToast
    ? toast.loading(<AutoTagLoadingToast tag={tagDef} />)
    : undefined;

  try {
    const rawHits = await qdrantSimilarByPath(
      cfg.sourceId,
      sourcePath,
      candidateLimit,
    );
    const hits = rawHits
      .filter((hit) => isPathSelected(hit.file.path, cfg))
      .slice(0, candidateLimit);

    const visionRaster = embeddingImageRasterOptions(cfg.embeddingImagePreset);
    const matchedPaths: string[] = [];
    for (const hit of hits) {
      if (hit.file.path === sourcePath) {
        continue;
      }

      const snapshot = getTagSnapshot();
      if (tagIdsForPath(snapshot, hit.file.path).includes(tagId)) {
        continue;
      }
      if (pendingTagIdsForPath(snapshot, hit.file.path).includes(tagId)) {
        continue;
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
        if (isMatch) {
          matchedPaths.push(hit.file.path);
          if (matchedPaths.length >= maxNewSuggestions) {
            break;
          }
        }
      } catch (error) {
        autoTagLog.error("judge failed", {
          labeled: sourcePath,
          candidate: hit.file.path,
          error: formatError(error),
        });
      }
    }

    if (toastId) {
      toast.dismiss(toastId);
    }

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
      return 0;
    }

    const next = mergePendingAutoTagBatch(base, filtered, tagId);
    setTagSnapshot(next);

    const totalPending = countPendingSuggestionPairs(next);
    if (showLoadingToast) {
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
    }

    return filtered.length;
  } catch (error) {
    autoTagLog.error("Auto-tagging failed", { error: formatError(error) });
    if (toastId) {
      toast.error(`Auto-tagging failed: ${String(error)}`, { id: toastId });
    }
    throw error;
  }
}

export async function generatePendingTagSuggestionsForTag(params: {
  cfg: LocalConfig;
  tagId: string;
  sourcePaths: string[];
}): Promise<number> {
  const { cfg, tagId, sourcePaths } = params;
  const tagState = getTagSnapshot();
  const tagDef = tagState.tags.find((tag) => tag.id === tagId);
  if (!tagDef || sourcePaths.length === 0) {
    return 0;
  }

  const toastId = toast.loading(<AutoTagLoadingToast tag={tagDef} />);
  let added = 0;

  try {
    for (const sourcePath of sourcePaths) {
      const snapshot = getTagSnapshot();
      const pendingForTag = Object.values(snapshot.pendingAutoTags).filter(
        (tagIds) => tagIds.includes(tagId),
      ).length;
      const candidateLimit = Math.min(
        256,
        Math.max(
          MANUAL_SUGGESTION_MIN_CANDIDATES,
          cfg.topK,
          MANUAL_SUGGESTION_MIN_CANDIDATES +
            pendingForTag * MANUAL_SUGGESTION_DEPTH_PER_PENDING,
        ),
      );
      added += await runAutoTagSuggestions(
        cfg,
        sourcePath,
        tagId,
        undefined,
        false,
        candidateLimit,
        MANUAL_SUGGESTION_BATCH_SIZE - added,
      );
      if (added >= MANUAL_SUGGESTION_BATCH_SIZE) {
        break;
      }
    }

    const totalPending = countPendingSuggestionPairs(getTagSnapshot());
    if (added === 0) {
      toast.info(`No new suggested files for ${tagDef.name}.`, {
        id: toastId,
      });
    } else {
      toast.success(<AutoTagReviewToast tag={tagDef} count={totalPending} />, {
        id: toastId,
        classNames: {
          toast: "!w-[min(100vw-2rem,18rem)]",
        },
      });
    }

    return added;
  } catch (error) {
    autoTagLog.error("Auto-tagging failed", { error: formatError(error) });
    toast.error(`Auto-tagging failed: ${String(error)}`, { id: toastId });
    throw error;
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

export function renameTagDefinition(tagId: string, name: string): void {
  const trimmedName = name.trim();
  if (!trimmedName) return;

  setTagSnapshot((prev) => ({
    ...prev,
    tags: prev.tags.map((tag) =>
      tag.id === tagId ? { ...tag, name: trimmedName } : tag,
    ),
  }));
}

export function updateTagColorDefinition(tagId: string, color: string): void {
  const trimmedColor = color.trim();
  if (!trimmedColor) return;

  setTagSnapshot((prev) => ({
    ...prev,
    tags: prev.tags.map((tag) =>
      tag.id === tagId ? { ...tag, color: trimmedColor } : tag,
    ),
  }));
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
