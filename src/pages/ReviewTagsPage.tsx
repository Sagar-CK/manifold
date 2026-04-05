import { ArrowLeft, Check } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useMemo, useState, useEffect } from "react";
import { navigateBackOrFallback } from "../lib/navigateBack";
import { ReviewPendingTagRow } from "../components/ReviewPendingTagRow";
import {
  acceptPendingAutoTag,
  rejectPendingAutoTag,
  acceptAllPendingForTag,
  rejectAllPendingForTag,
  saveTagsState,
  tagIdsForPath,
  loadTagsState,
  type TagDef,
  type TagsState,
} from "../lib/tags";
import { TagDefLabel } from "../components/TagDefBadge";
import { syncPathTagsToQdrant } from "../lib/qdrantTags";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip";
import { ScrollArea } from "../components/ui/scroll-area";
import { isPreviewablePath, useThumbnailsForPaths } from "../lib/useThumbnailsForPaths";

export function ReviewTagsPage({
  sourceId,
}: {
  sourceId: string;
}) {
  const navigate = useNavigate();
  const [tagsState, setTagsState] = useState<TagsState>(() => loadTagsState());

  useEffect(() => {
    const onTagsUpdated = () => setTagsState(loadTagsState());
    window.addEventListener("manifold:tags-updated", onTagsUpdated);
    return () => window.removeEventListener("manifold:tags-updated", onTagsUpdated);
  }, []);

  const pendingPaths = Object.keys(tagsState.pendingAutoTags || {}).filter(
    (p) => tagsState.pendingAutoTags[p]?.length > 0,
  );

  const thumbPathsKey = pendingPaths.join("\0");
  const { thumbByPath, thumbFailedByPath } = useThumbnailsForPaths(thumbPathsKey, pendingPaths);

  const hasPending = pendingPaths.length > 0;

  const pendingRows = useMemo(() => {
    const rows: Array<{ path: string; tagId: string; key: string; tagDef: TagDef }> = [];
    for (const path of pendingPaths) {
      for (const tagId of tagsState.pendingAutoTags[path] ?? []) {
        const tagDef = tagsState.tags.find((t) => t.id === tagId);
        if (!tagDef) continue;
        rows.push({ path, tagId, key: `${path}:${tagId}`, tagDef });
      }
    }
    return rows;
  }, [pendingPaths, tagsState.pendingAutoTags, tagsState.tags]);

  const sections = useMemo(() => {
    const map = new Map<string, { tagDef: TagDef; rows: typeof pendingRows }>();
    for (const row of pendingRows) {
      let g = map.get(row.tagId);
      if (!g) {
        g = { tagDef: row.tagDef, rows: [] };
        map.set(row.tagId, g);
      }
      g.rows.push(row);
    }
    const order = new Map(tagsState.tags.map((t, i) => [t.id, i] as const));
    return Array.from(map.entries())
      .map(([tagId, v]) => ({ tagId, tagDef: v.tagDef, rows: v.rows }))
      .sort((a, b) => (order.get(a.tagId) ?? 999) - (order.get(b.tagId) ?? 999));
  }, [pendingRows, tagsState.tags]);

  const handleAccept = (path: string, tagId: string) => {
    const next = acceptPendingAutoTag(tagsState, path, tagId);
    setTagsState(next);
    saveTagsState(next);
    void syncPathTagsToQdrant(sourceId, path, tagIdsForPath(next, path)).catch(() => {});
  };

  const handleReject = (path: string, tagId: string) => {
    const next = rejectPendingAutoTag(tagsState, path, tagId);
    setTagsState(next);
    saveTagsState(next);
  };

  const handleAcceptAllForTag = (tagId: string) => {
    const pathsWithTag = Object.keys(tagsState.pendingAutoTags).filter((p) =>
      tagsState.pendingAutoTags[p]?.includes(tagId),
    );
    const next = acceptAllPendingForTag(tagsState, tagId);
    setTagsState(next);
    saveTagsState(next);
    for (const path of pathsWithTag) {
      void syncPathTagsToQdrant(sourceId, path, tagIdsForPath(next, path)).catch(() => {});
    }
  };

  const handleRejectAllForTag = (tagId: string) => {
    const next = rejectAllPendingForTag(tagsState, tagId);
    setTagsState(next);
    saveTagsState(next);
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="relative mb-6 shrink-0 flex flex-col items-center gap-2 text-center">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="absolute left-0 top-0 inline-flex h-9 w-9 items-center justify-center rounded-md text-black/70 hover:bg-black/5 hover:text-black"
              aria-label="Back"
              onClick={() => navigateBackOrFallback(navigate)}
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Back</TooltipContent>
        </Tooltip>
        <PageHeader heading="Review tags" />
      </div>

      <div className="min-h-0 flex-1">
        {!hasPending ? (
          <div className="flex h-full min-h-0 flex-col items-center justify-center rounded-2xl bg-muted/30 py-24 text-center">
            <Check className="mb-5 size-14 text-muted-foreground/25" strokeWidth={1.75} aria-hidden />
            <p className="text-lg font-semibold tracking-tight text-foreground">Nothing pending</p>
            <p className="mt-1.5 text-sm text-muted-foreground">No suggestions.</p>
          </div>
        ) : (
          <ScrollArea className="h-full pr-3">
            <div className="flex flex-col gap-8 pb-8">
              {sections.map(({ tagId, tagDef, rows }) => (
                <section key={tagId} className="flex flex-col gap-3">
                  <div className="flex flex-col gap-2 border-b border-black/10 pb-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <TagDefLabel tag={tagDef} className="text-sm" />
                    </div>
                    <div className="flex flex-wrap gap-2 sm:justify-end">
                      <Button onClick={() => handleRejectAllForTag(tagId)} variant="outline" size="sm">
                        Reject all
                      </Button>
                      <Button onClick={() => handleAcceptAllForTag(tagId)} variant="default" size="sm">
                        Accept all
                      </Button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                    {rows.map(({ path, tagId: rowTagId, key, tagDef: rowTag }) => {
                      const preview = isPreviewablePath(path);
                      return (
                        <ReviewPendingTagRow
                          key={key}
                          path={path}
                          tag={rowTag}
                          showTagBadge={false}
                          thumbUrl={thumbByPath[path] ?? null}
                          thumbFailed={!!thumbFailedByPath[path]}
                          thumbExpectLoading={preview && !thumbFailedByPath[path]}
                          onAccept={() => handleAccept(path, rowTagId)}
                          onReject={() => handleReject(path, rowTagId)}
                        />
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          </ScrollArea>
        )}
      </div>
    </section>
  );
}