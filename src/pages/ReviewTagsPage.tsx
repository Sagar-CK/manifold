import { ArrowLeft, Check } from "lucide-react";
import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { openPathInDefaultApp as tryOpenPathInDefaultApp } from "@/lib/files";
import {
  acceptAllPendingTagsForTag,
  acceptPendingTag,
  rejectAllPendingTagsForTag,
  rejectPendingTag,
} from "@/lib/tagActions";
import { useTagsState } from "@/lib/useTagsState";
import { PageHeader } from "../components/PageHeader";
import { ReviewPendingTagRow } from "../components/ReviewPendingTagRow";
import { TagDefLabel } from "../components/TagDefBadge";
import { Button } from "../components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../components/ui/empty";
import { ScrollArea } from "../components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../components/ui/tooltip";
import { createLogger } from "../lib/log";
import { navigateBackOrFallback } from "../lib/navigateBack";
import {
  pruneIndexedPathIfMissing,
  pruneMissingIndexedPathsFromList,
} from "../lib/staleIndexedPaths";
import type { TagDef } from "../lib/tags";
import {
  isPreviewablePath,
  useThumbnailsForPaths,
} from "../lib/useThumbnailsForPaths";

const reviewLog = createLogger("review-tags");

async function openPathInDefaultApp(path: string) {
  const error = await tryOpenPathInDefaultApp(path);
  if (error) {
    reviewLog.error("openPath failed", { path, error });
  }
}

export function ReviewTagsPage({ sourceId }: { sourceId: string }) {
  const navigate = useNavigate();
  const [tagsState] = useTagsState();

  const pendingPaths = Object.keys(tagsState.pendingAutoTags).filter(
    (p) => tagsState.pendingAutoTags[p]?.length > 0,
  );

  const thumbPathsKey = pendingPaths.join("\0");
  const { thumbByPath, thumbFailedByPath } = useThumbnailsForPaths(
    thumbPathsKey,
    pendingPaths,
    {
      onThumbError: (path, error) => {
        void pruneIndexedPathIfMissing(sourceId, path, error).catch(
          (cleanupError) => {
            reviewLog.warn("stale review thumbnail cleanup failed", {
              path,
              error: String(cleanupError),
            });
          },
        );
      },
    },
  );

  const hasPending = pendingPaths.length > 0;

  useEffect(() => {
    if (pendingPaths.length === 0) return;
    void pruneMissingIndexedPathsFromList(sourceId, pendingPaths).catch(
      (error) => {
        reviewLog.warn("review stale suggestion prune failed", {
          count: pendingPaths.length,
          error: String(error),
        });
      },
    );
  }, [sourceId, thumbPathsKey]);

  const pendingRows = useMemo(() => {
    const rows: Array<{
      path: string;
      tagId: string;
      key: string;
      tagDef: TagDef;
    }> = [];
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
      .sort(
        (a, b) => (order.get(a.tagId) ?? 999) - (order.get(b.tagId) ?? 999),
      );
  }, [pendingRows, tagsState.tags]);

  const handleAccept = (path: string, tagId: string) => {
    acceptPendingTag(path, tagId, sourceId);
  };

  const handleReject = (path: string, tagId: string) => {
    rejectPendingTag(path, tagId);
  };

  const handleAcceptAllForTag = (tagId: string) => {
    acceptAllPendingTagsForTag(tagId, sourceId);
  };

  const handleRejectAllForTag = (tagId: string) => {
    rejectAllPendingTagsForTag(tagId);
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="relative shrink-0 flex flex-col items-center gap-2 text-center">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute left-0 top-0 text-muted-foreground"
              aria-label="Back"
              onClick={() => navigateBackOrFallback(navigate)}
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Back</TooltipContent>
        </Tooltip>
        <PageHeader heading="Review tags" />
      </div>

      <div className="min-h-0 flex-1">
        {!hasPending ? (
          <Empty className="min-h-full border-border/60 bg-muted/10 py-24">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Check
                  className="text-muted-foreground"
                  strokeWidth={1.75}
                  aria-hidden
                />
              </EmptyMedia>
              <EmptyTitle>Nothing pending</EmptyTitle>
              <EmptyDescription>No suggestions.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ScrollArea className="h-full pr-3">
            <div className="flex flex-col gap-8 pb-8">
              {sections.map(({ tagId, tagDef, rows }) => (
                <section key={tagId} className="flex flex-col gap-3">
                  <div className="flex flex-col gap-2 border-b border-border pb-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <TagDefLabel tag={tagDef} className="text-sm" />
                    </div>
                    <div className="flex flex-wrap gap-2 sm:justify-end">
                      <Button
                        onClick={() => handleRejectAllForTag(tagId)}
                        variant="outline"
                        size="sm"
                      >
                        Reject all
                      </Button>
                      <Button
                        onClick={() => handleAcceptAllForTag(tagId)}
                        variant="secondary"
                        size="sm"
                      >
                        Accept all
                      </Button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                    {rows.map(
                      ({ path, tagId: rowTagId, key, tagDef: rowTag }) => {
                        const preview = isPreviewablePath(path);
                        return (
                          <ReviewPendingTagRow
                            key={key}
                            path={path}
                            tag={rowTag}
                            showTagBadge={false}
                            thumbUrl={thumbByPath[path] ?? null}
                            thumbFailed={!!thumbFailedByPath[path]}
                            thumbExpectLoading={
                              preview && !thumbFailedByPath[path]
                            }
                            onAccept={() => handleAccept(path, rowTagId)}
                            onReject={() => handleReject(path, rowTagId)}
                            onInspectFile={(e) => {
                              if (e.metaKey || e.ctrlKey) {
                                e.preventDefault();
                                void openPathInDefaultApp(path);
                                return;
                              }
                              navigate(
                                `/file?path=${encodeURIComponent(path)}`,
                                {
                                  state: { returnTo: "/review-tags" },
                                },
                              );
                            }}
                          />
                        );
                      },
                    )}
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
