import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { useEffect, useMemo, useState } from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { AppAlert } from "@/components/app/AppAlert";
import { PageHeaderNav } from "@/components/app/PageHeaderNav";
import { ContentHashPathPickerDialog } from "@/components/files/ContentHashPathPickerDialog";
import { FileSearchResultCard } from "@/components/files/FileSearchResultCard";
import { PdfTextMatchPreview } from "@/components/files/PdfTextMatchPreview";
import { TagFilterPill } from "@/components/tags/TagFilterPill";
import { ImgReveal } from "@/components/ui/img-reveal";
import {
  qdrantSimilarByPath,
  type SimilarHit,
  thumbnailImageBase64Png,
} from "@/lib/api/desktop";
import type { LocalConfig } from "@/lib/config/localConfig";
import { invokeErrorText } from "@/lib/errors";
import {
  fileExtension,
  fileTypeLabelFromPath,
  formatSimilarityScore,
  openPathInDefaultApp,
} from "@/lib/files";
import { isPathSelected } from "@/lib/files/pathSelection";
import { pruneIndexedPathIfMissing } from "@/lib/files/staleIndexedPaths";
import {
  isPreviewablePath,
  useThumbnailsForPaths,
} from "@/lib/files/useThumbnailsForPaths";
import { navigateToSearch } from "@/lib/navigation/navigateToSearch";
import { groupByContentHash } from "@/lib/search/resultGrouping";
import { useHomeDir } from "@/lib/system/useHomeDir";
import { toggleTagForPath } from "@/lib/tags/actions";
import { useTagsState } from "@/lib/tags/useTagsState";
import { cn } from "@/lib/utils";
import { Button } from "../components/ui/button";
import { HugeIcon } from "../components/ui/huge-icon";
import { Label } from "../components/ui/label";
import { ScrollArea } from "../components/ui/scroll-area";
import { Skeleton } from "../components/ui/skeleton";
import { tagIdsForPath, tagsForPath } from "../lib/tags";

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
  /** When opening a PDF from hybrid text/OCR search, drive in-app match preview. */
  pdfTextMatch?: {
    searchQuery: string;
    matchKind: "text" | "ocr";
  };
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
  const ext = filePath ? fileExtension(filePath) : "";
  const pdfMatch =
    ext === "pdf" && locState?.pdfTextMatch?.searchQuery?.trim()
      ? locState.pdfTextMatch
      : null;

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
    navigateToSearch(navigate, dest ?? "/");
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

  async function openFilePath(path: string) {
    setOpenError(await openPathInDefaultApp(path));
  }

  if (!filePath) {
    return (
      <section className="flex min-h-0 flex-1 flex-col gap-6">
        <div className="relative shrink-0">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-fit gap-1 px-2 text-muted-foreground"
            aria-label="Back"
            onClick={leaveFileView}
          >
            <HugeIcon icon={ArrowLeft01Icon} className="size-4" aria-hidden />
            Back
          </Button>
          <PageHeaderNav />
        </div>
        <p className="app-muted text-sm">No file selected.</p>
      </section>
    );
  }

  const activeFilePath = filePath;

  const thumbnailButton = (
    <button
      type="button"
      className="flex h-24 w-28 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-muted/15 shadow-none transition-colors hover:bg-muted/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      aria-label="Open file"
      onClick={() => openFilePath(filePath)}
    >
      {canThumb ? (
        thumbDataUrl ? (
          <ImgReveal
            src={thumbDataUrl}
            alt=""
            className="max-h-[5.25rem] max-w-full rounded-md object-contain"
          />
        ) : thumbLoading ? (
          <Skeleton className="h-16 w-24 rounded-md" />
        ) : (
          <span className="app-label">{fileTypeLabelFromPath(filePath)}</span>
        )
      ) : (
        <span className="app-label">{fileTypeLabelFromPath(filePath)}</span>
      )}
    </button>
  );

  const pathButtons = displayPaths.map((p, index) => {
    const fileName = p.split("/").pop() ?? p;

    return (
      <div key={p} className="flex w-full max-w-3xl items-start gap-2 text-sm">
        <button
          type="button"
          className="min-w-0 flex-1 rounded-lg bg-muted/45 px-3 py-2 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          onClick={() => openFilePath(p)}
        >
          <div className="flex min-w-0 items-baseline gap-2">
            {displayPaths.length > 1 ? (
              <span className="app-label shrink-0">Path {index + 1}</span>
            ) : null}
            <span className="min-w-0 truncate text-sm font-medium leading-5 text-foreground">
              {fileName}
            </span>
          </div>
          <div className="mt-1 min-w-0 truncate text-xs text-muted-foreground">
            {p}
          </div>
        </button>
      </div>
    );
  });

  const statusAlerts = (
    <>
      <AppAlert variant="inline" className="text-xs" message={openError} />
      <AppAlert
        variant="inline"
        className="text-xs"
        message={staleCleanupMessage}
      />
    </>
  );

  function renderTagsPanel(className?: string) {
    return (
      <div className={cn("flex flex-col gap-2.5", className)}>
        <Label className="app-section-title text-sm">Tags</Label>
        {tagsState.tags.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Create tags in{" "}
            <Link className="app-link font-medium" to="/review-tags">
              Tags
            </Link>
            , then toggle them here.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {tagsState.tags.map((t) => {
              const active = tagIdsForPath(tagsState, activeFilePath).includes(
                t.id,
              );
              return (
                <TagFilterPill
                  key={t.id}
                  tag={t}
                  pressed={active}
                  ariaLabel={
                    active ? `Remove tag ${t.name}` : `Add tag ${t.name}`
                  }
                  onPressedChange={() => {
                    void toggleTagForPath({
                      path: activeFilePath,
                      tagId: t.id,
                      sourceId: cfg.sourceId,
                      cfg,
                      navigateToReviewTags: () => navigate("/review-tags"),
                    });
                  }}
                />
              );
            })}
          </div>
        )}
      </div>
    );
  }

  const pdfPreview = pdfMatch ? (
    <PdfTextMatchPreview
      filePath={filePath}
      searchQuery={pdfMatch.searchQuery}
      matchKind={pdfMatch.matchKind}
      className="w-full"
      viewerClassName="max-h-[min(46vh,28rem)]"
    />
  ) : null;

  return (
    <section className="flex h-full min-h-0 flex-1 flex-col">
      <div className="relative shrink-0 pb-5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-fit gap-1 px-2 text-muted-foreground"
          aria-label={trail.length > 1 ? "Back to previous file" : "Back"}
          onClick={goBackFromFileResult}
        >
          <HugeIcon icon={ArrowLeft01Icon} className="size-4" aria-hidden />
          Back
        </Button>
        <PageHeaderNav />
      </div>

      <ScrollArea className="min-h-0 flex-1 pr-3">
        <div className="flex min-h-0 flex-col gap-5 pb-8">
          {pdfPreview ? (
            <div className="grid min-h-0 gap-5 lg:grid-cols-[minmax(18rem,24rem)_minmax(0,1fr)] lg:items-start">
              <div className="flex min-w-0 flex-col gap-4">
                <div className="flex min-w-0 items-start gap-4">
                  {thumbnailButton}
                  <div className="flex min-w-0 flex-1 flex-col items-start gap-2 pt-0.5">
                    {pathButtons}
                    {statusAlerts}
                  </div>
                </div>
                {renderTagsPanel()}
              </div>
              <div className="min-w-0">{pdfPreview}</div>
            </div>
          ) : (
            <div className="flex flex-row gap-4 sm:gap-5">
              {thumbnailButton}
              <div className="flex min-w-0 flex-1 flex-col items-start gap-2 pt-0.5">
                {pathButtons}
                {statusAlerts}
                {renderTagsPanel("mt-3")}
              </div>
            </div>
          )}

          <div className="flex min-h-0 flex-col">
            <h2 className="app-section-title mb-3">Similar</h2>
            {similarLoading ? (
              <p className="app-muted text-sm">Loading…</p>
            ) : similarError ? (
              <AppAlert
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
                      thumbExpectLoading={
                        isPreviewFile && !thumbFailedByPath[p]
                      }
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
                    />
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </ScrollArea>

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
