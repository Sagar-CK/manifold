import { ArrowLeft, ExternalLink } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  qdrantSimilarByPath,
  type SimilarHit,
  thumbnailImageBase64Png,
} from "@/lib/api/tauri";
import { invokeErrorText } from "@/lib/errors";
import {
  fileExtension,
  fileTypeLabelFromPath,
  formatSimilarityScore,
  openPathInDefaultApp,
} from "@/lib/files";
import { groupByContentHash } from "@/lib/resultGrouping";
import { pruneIndexedPathIfMissing } from "@/lib/staleIndexedPaths";
import { toggleTagForPath } from "@/lib/tagActions";
import { ContentHashPathPickerDialog } from "../components/ContentHashPathPickerDialog";
import { ErrorMessage } from "../components/ErrorMessage";
import { FileSearchResultCard } from "../components/FileSearchResultCard";
import { TagsPathDropdown } from "../components/TagsPathDropdown";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Label } from "../components/ui/label";
import { ScrollArea } from "../components/ui/scroll-area";
import { Skeleton } from "../components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../components/ui/tooltip";
import type { LocalConfig } from "../lib/localConfig";
import { navigateBackOrFallback } from "../lib/navigateBack";
import { formatIndexedPathForDisplay } from "../lib/pathDisplay";
import { isPathSelected } from "../lib/pathSelection";
import { tagIdsForPath, tagsForPath } from "../lib/tags";
import { useHomeDir } from "../lib/useHomeDir";
import { useTagsState } from "../lib/useTagsState";
import {
  isPreviewablePath,
  useThumbnailsForPaths,
} from "../lib/useThumbnailsForPaths";

type SimilarGroup = {
  key: string;
  primary: SimilarHit;
  variants: SimilarHit[];
};

export type FileResultLocationState = {
  /** Exploration stack: each similar-file drill appends the path (Back pops one level). */
  resultStack?: string[];
  /** Indexed paths with identical content (e.g. from search duplicate picker). */
  sameContentPaths?: string[];
  /** Route to open when leaving file view at stack root (set by search / graph / review). */
  returnTo?: string;
};

export function FileResultPage({ cfg }: { cfg: LocalConfig }) {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const rawPath = searchParams.get("path");
  const filePath = rawPath ? decodeURIComponent(rawPath) : null;
  const locState = location.state as FileResultLocationState | undefined;

  const [thumbDataUrl, setThumbDataUrl] = useState<string | null>(null);
  const [thumbLoading, setThumbLoading] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const [staleCleanupMessage, setStaleCleanupMessage] = useState<string | null>(
    null,
  );

  const [trail, setTrail] = useState<string[]>([]);
  const [similar, setSimilar] = useState<SimilarHit[]>([]);
  const [similarLoading, setSimilarLoading] = useState(false);
  const [similarError, setSimilarError] = useState<string | null>(null);
  const [pathChooserOpen, setPathChooserOpen] = useState(false);
  const [selectedSimilarGroup, setSelectedSimilarGroup] =
    useState<SimilarGroup | null>(null);
  const [pathChooserOpenInAppMode, setPathChooserOpenInAppMode] =
    useState(false);
  const homePath = useHomeDir();
  const [tagsState] = useTagsState();

  const canThumb = filePath ? isPreviewablePath(filePath) : false;

  useEffect(() => {
    if (!filePath) {
      setTrail([]);
      return;
    }
    const fromState = locState?.resultStack;
    if (fromState?.length && fromState[fromState.length - 1] === filePath) {
      setTrail(fromState);
      return;
    }
    setTrail([filePath]);
  }, [filePath, location.key]);

  const displayPaths = useMemo(() => {
    if (!filePath) return [];
    const aliases = locState?.sameContentPaths;
    if (aliases?.length) {
      const merged = new Set<string>(aliases);
      merged.add(filePath);
      return Array.from(merged).sort((a, b) => a.localeCompare(b));
    }
    return [filePath];
  }, [filePath, location.key, locState?.sameContentPaths]);

  const headerPathExcludeSet = useMemo(
    () => new Set(displayPaths),
    [displayPaths],
  );

  useEffect(() => {
    setStaleCleanupMessage(null);
  }, [filePath]);

  useEffect(() => {
    setThumbDataUrl(null);
    setOpenError(null);
    if (!filePath || !canThumb) {
      setThumbLoading(false);
      return;
    }

    let cancelled = false;
    setThumbLoading(true);
    void (async () => {
      try {
        const thumb = await thumbnailImageBase64Png(filePath, 96, 0);
        if (cancelled) return;
        setThumbDataUrl(`data:image/png;base64,${thumb.png_base64}`);
      } catch (error) {
        if (!cancelled) {
          setThumbDataUrl(null);
          void pruneIndexedPathIfMissing(cfg.sourceId, filePath, error)
            .then((didPrune) => {
              if (cancelled || !didPrune) return;
              setSimilar([]);
              setStaleCleanupMessage(
                "This file no longer exists, so its stale search entry was removed from the index.",
              );
            })
            .catch((cleanupError) => {
              if (cancelled) return;
              setStaleCleanupMessage(
                `This file no longer exists, but removing its stale search entry failed: ${invokeErrorText(cleanupError)}`,
              );
            });
        }
      } finally {
        if (!cancelled) setThumbLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [filePath, canThumb]);

  useEffect(() => {
    setSimilar([]);
    setSimilarError(null);
    if (!filePath) {
      setSimilarLoading(false);
      return;
    }

    let cancelled = false;
    setSimilarLoading(true);
    void (async () => {
      try {
        const hits = await qdrantSimilarByPath(
          cfg.sourceId,
          filePath,
          cfg.topK,
        );
        if (cancelled) return;
        const scoped = hits.filter((h) => isPathSelected(h.file.path, cfg));
        const filtered = scoped.filter(
          (h) => !headerPathExcludeSet.has(h.file.path),
        );
        setSimilar(filtered);
      } catch (error) {
        if (!cancelled) setSimilarError(String(error));
      } finally {
        if (!cancelled) setSimilarLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    filePath,
    cfg.sourceId,
    cfg.topK,
    cfg.include,
    cfg.exclude,
    cfg.extensions,
    cfg.useDefaultFolderExcludes,
    headerPathExcludeSet,
  ]);

  const similarGroups = useMemo(
    () =>
      groupByContentHash(similar, (currentPrimary, candidate) =>
        candidate.score > currentPrimary.score ? candidate : currentPrimary,
      ).map((group) => ({
        key: group.key,
        primary: group.primary,
        variants: group.variants,
      })),
    [similar],
  );
  const thumbPathList = useMemo(
    () => similarGroups.map((g) => g.primary.file.path),
    [similarGroups],
  );
  const thumbPathsKey = thumbPathList.join("\0");
  const { thumbByPath, thumbFailedByPath } = useThumbnailsForPaths(
    thumbPathsKey,
    thumbPathList,
    {
      onThumbError: (path, error) => {
        void pruneIndexedPathIfMissing(cfg.sourceId, path, error).catch(
          () => {},
        );
      },
    },
  );

  function leaveFileView() {
    const dest = locState?.returnTo;
    // Pop one history entry when possible — navigate(returnTo) would push a duplicate
    // parent (graph / search / review) and trap Back between file ↔ that route.
    navigateBackOrFallback(navigate, dest ?? "/");
  }

  function goBackFromFileResult() {
    if (trail.length > 1) {
      const parent = trail[trail.length - 2]!;
      navigate(`/file?path=${encodeURIComponent(parent)}`, {
        replace: true,
        state: {
          resultStack: trail.slice(0, -1),
          ...(locState?.returnTo != null
            ? { returnTo: locState.returnTo }
            : {}),
        },
      });
    } else {
      leaveFileView();
    }
  }

  if (!filePath) {
    return (
      <section className="flex min-h-0 flex-1 flex-col gap-6">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-fit gap-1 px-2 text-muted-foreground"
              aria-label="Back"
              onClick={leaveFileView}
            >
              <ArrowLeft className="size-4" aria-hidden />
              Back
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Back</TooltipContent>
        </Tooltip>
        <p className="app-muted text-sm">No file selected.</p>
      </section>
    );
  }

  return (
    <section className="flex h-full min-h-0 flex-1 flex-col gap-5">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-fit gap-1 px-2 text-muted-foreground"
            aria-label={trail.length > 1 ? "Back to previous file" : "Back"}
            onClick={goBackFromFileResult}
          >
            <ArrowLeft className="size-4" aria-hidden />
            Back
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {trail.length > 1 ? "Back to previous file" : "Back"}
        </TooltipContent>
      </Tooltip>

      <div className="flex flex-row gap-4 sm:gap-5">
        <div className="flex h-24 w-28 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-muted/15 shadow-none">
          {canThumb ? (
            thumbDataUrl ? (
              <img
                src={thumbDataUrl}
                alt=""
                className="max-h-[5.25rem] max-w-full rounded-md object-contain"
              />
            ) : thumbLoading ? (
              <Skeleton className="h-16 w-24 rounded-md" />
            ) : (
              <span className="app-label">
                {fileTypeLabelFromPath(filePath)}
              </span>
            )
          ) : (
            <span className="app-label">{fileTypeLabelFromPath(filePath)}</span>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col items-start gap-2 pt-0.5">
          {displayPaths.map((p) => (
            <div key={p} className="flex max-w-full items-center gap-2 text-sm">
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="min-w-0 w-fit max-w-full cursor-default truncate rounded-full border border-border/70 bg-muted/15 px-3 py-1.5 font-mono text-[12px] text-muted-foreground sm:max-w-lg">
                    {formatIndexedPathForDisplay(p, homePath, cfg.include)}
                  </div>
                </TooltipTrigger>
                <TooltipContent
                  side="bottom"
                  className="max-w-md break-all font-mono text-xs"
                >
                  {p}
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                    aria-label={`Open ${p}`}
                    onClick={async () => {
                      setOpenError(await openPathInDefaultApp(p));
                    }}
                  >
                    <ExternalLink className="h-4 w-4" aria-hidden />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  Open in default app
                </TooltipContent>
              </Tooltip>
            </div>
          ))}
          <ErrorMessage
            variant="inline"
            className="text-xs"
            message={openError}
          />
          <ErrorMessage
            variant="inline"
            className="text-xs"
            message={staleCleanupMessage}
          />

          <div className="mt-3 flex flex-col gap-2.5">
            <Label className="app-section-title text-sm">Tags</Label>
            {tagsState.tags.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Create tags in Settings, then toggle them here.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {tagsState.tags.map((t) => {
                  const active = tagIdsForPath(tagsState, filePath).includes(
                    t.id,
                  );
                  return (
                    <Button
                      key={t.id}
                      type="button"
                      variant="ghost"
                      className="h-auto p-0 font-normal hover:bg-transparent"
                      aria-label={
                        active ? `Remove tag ${t.name}` : `Add tag ${t.name}`
                      }
                      onClick={() => {
                        void toggleTagForPath({
                          path: filePath,
                          tagId: t.id,
                          sourceId: cfg.sourceId,
                          cfg,
                          navigateToReviewTags: () => navigate("/review-tags"),
                        });
                      }}
                    >
                      <Badge
                        variant={active ? "secondary" : "outline"}
                        className="gap-1.5 border-border/70 font-normal"
                      >
                        <span
                          className="size-1.5 shrink-0 rounded-full"
                          style={{ backgroundColor: t.color }}
                          aria-hidden="true"
                        />
                        {t.name}
                      </Badge>
                    </Button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <h2 className="app-section-title mb-3">Similar</h2>
        <ScrollArea className="min-h-0 flex-1 pr-3">
          {similarLoading ? (
            <p className="app-muted text-sm">Loading…</p>
          ) : similarError ? (
            <ErrorMessage
              variant="inline"
              className="text-sm"
              message={similarError}
            />
          ) : similarGroups.length === 0 ? (
            <p className="app-muted text-sm">
              No similar files in the current scope.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {similarGroups.map((group) => {
                const hit = group.primary;
                const p = hit.file.path;
                const pExt = fileExtension(p);
                const isPreviewImage =
                  pExt === "png" || pExt === "jpg" || pExt === "jpeg";
                const isPreviewFile = isPreviewImage || pExt === "pdf";
                const isStacked = group.variants.length > 1;
                return (
                  <FileSearchResultCard
                    key={group.key}
                    path={p}
                    thumbUrl={thumbByPath[p] ?? null}
                    thumbFailed={!!thumbFailedByPath[p]}
                    thumbExpectLoading={isPreviewFile && !thumbFailedByPath[p]}
                    hoverChip={
                      cfg.showSimilarityOnHover
                        ? `Similarity ${formatSimilarityScore(hit.score)}`
                        : null
                    }
                    onClick={(e) => {
                      const openInApp = e.metaKey || e.ctrlKey;
                      if (openInApp) {
                        e.preventDefault();
                        if (isStacked) {
                          setPathChooserOpenInAppMode(true);
                          setSelectedSimilarGroup(group);
                          setPathChooserOpen(true);
                          return;
                        }
                        setOpenError(null);
                        void openPathInDefaultApp(p).then((error) => {
                          setOpenError(error);
                        });
                        return;
                      }
                      if (isStacked) {
                        setPathChooserOpenInAppMode(false);
                        setSelectedSimilarGroup(group);
                        setPathChooserOpen(true);
                        return;
                      }
                      navigate(`/file?path=${encodeURIComponent(p)}`, {
                        state: {
                          resultStack: [...trail, p],
                          ...(locState?.returnTo != null
                            ? { returnTo: locState.returnTo }
                            : {}),
                        },
                      });
                    }}
                    tagDots={tagsForPath(tagsState, p)}
                    tagMenuSlot={
                      tagsState.tags.length > 0 ? (
                        <TagsPathDropdown
                          path={p}
                          sourceId={cfg.sourceId}
                          tagsState={tagsState}
                          cfg={cfg}
                        />
                      ) : null
                    }
                  />
                );
              })}
            </div>
          )}
        </ScrollArea>
      </div>

      <ContentHashPathPickerDialog
        open={pathChooserOpen}
        onOpenChange={(open) => {
          setPathChooserOpen(open);
          if (!open) {
            setSelectedSimilarGroup(null);
            setPathChooserOpenInAppMode(false);
          }
        }}
        paths={(selectedSimilarGroup?.variants ?? []).map((v) => v.file.path)}
        homePath={homePath}
        includeRoots={cfg.include}
        title={pathChooserOpenInAppMode ? "Open in default app" : "Choose file"}
        description={
          pathChooserOpenInAppMode
            ? "These files have identical content. Select the path to open with the system's default application."
            : "These files have identical content. Select the path to continue exploring similar files."
        }
        onSelectPath={(p) => {
          const variants = selectedSimilarGroup?.variants ?? [];
          if (pathChooserOpenInAppMode) {
            void openPathInDefaultApp(p).then((error) => {
              setOpenError(error);
            });
          } else {
            navigate(`/file?path=${encodeURIComponent(p)}`, {
              state: {
                resultStack: [...trail, p],
                sameContentPaths: variants.map((v) => v.file.path),
                ...(locState?.returnTo != null
                  ? { returnTo: locState.returnTo }
                  : {}),
              },
            });
          }
          setPathChooserOpen(false);
          setSelectedSimilarGroup(null);
          setPathChooserOpenInAppMode(false);
        }}
      />
    </section>
  );
}
