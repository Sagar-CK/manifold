import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { homeDir } from "@tauri-apps/api/path";
import { openPath } from "@tauri-apps/plugin-opener";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { ErrorMessage } from "../components/ErrorMessage";
import { FileSearchResultCard } from "../components/FileSearchResultCard";
import { TagsPathDropdown } from "../components/TagsPathDropdown";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Skeleton } from "../components/ui/skeleton";
import { ScrollArea } from "../components/ui/scroll-area";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../components/ui/alert-dialog";
import { invokeErrorText } from "../lib/errors";
import type { LocalConfig } from "../lib/localConfig";
import { navigateBackOrFallback } from "../lib/navigateBack";
import { runAutoTagOrchestration } from "../lib/autoTagging";
import { formatIndexedPathForDisplay } from "../lib/pathDisplay";
import { isPathSelected } from "../lib/pathSelection";
import { useThumbnailsForPaths } from "../lib/useThumbnailsForPaths";
import { syncPathTagsToQdrant } from "../lib/qdrantTags";
import {
  loadTagsState,
  saveTagsState,
  tagIdsForPath,
  tagsForPath,
  togglePathTag,
  type TagsState,
} from "../lib/tags";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip";

type SimilarHit = {
  score: number;
  file: { path: string; contentHash: string };
};

type SimilarGroup = {
  key: string;
  primary: SimilarHit;
  variants: SimilarHit[];
};

function fileTypeLabel(path: string) {
  const ext = path.split(".").pop()?.replace(/^\./, "").trim().toUpperCase() ?? "";
  return ext || "FILE";
}

function formatSimilarityScore(score: number) {
  if (score >= 0 && score <= 1) return `${(score * 100).toFixed(1)}%`;
  return score.toFixed(4);
}

function groupSimilarByContentHash(hits: SimilarHit[]): SimilarGroup[] {
  const byHash = new Map<string, SimilarGroup>();
  for (const hit of hits) {
    const key = hit.file.contentHash || hit.file.path;
    const existing = byHash.get(key);
    if (!existing) {
      byHash.set(key, { key, primary: hit, variants: [hit] });
      continue;
    }
    existing.variants.push(hit);
    if (hit.score > existing.primary.score) {
      existing.primary = hit;
    }
  }
  return Array.from(byHash.values());
}

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

  const [trail, setTrail] = useState<string[]>([]);
  const [similar, setSimilar] = useState<SimilarHit[]>([]);
  const [similarLoading, setSimilarLoading] = useState(false);
  const [similarError, setSimilarError] = useState<string | null>(null);
  const [pathChooserOpen, setPathChooserOpen] = useState(false);
  const [selectedSimilarGroup, setSelectedSimilarGroup] = useState<SimilarGroup | null>(null);
  /** When true, duplicate-picker confirms open-in-default-app instead of navigating. */
  const [pathChooserOpenInAppMode, setPathChooserOpenInAppMode] = useState(false);
  const [homePath, setHomePath] = useState("");
  const [tagsState, setTagsState] = useState<TagsState>(() => loadTagsState());

  const ext = filePath?.split(".").pop()?.toLowerCase() ?? "";
  const canThumb = ext === "png" || ext === "jpg" || ext === "jpeg" || ext === "pdf";

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

  useEffect(() => {
    setTagsState(loadTagsState());
  }, [filePath]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const home = await homeDir();
        if (!cancelled) setHomePath(home);
      } catch {
        if (!cancelled) setHomePath("");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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

  const headerPathExcludeSet = useMemo(() => new Set(displayPaths), [displayPaths]);

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
        const thumb = (await invoke("thumbnail_image_base64_png", {
          args: { path: filePath, max_edge: 96, page: 0 },
        })) as { png_base64: string };
        if (cancelled) return;
        setThumbDataUrl(`data:image/png;base64,${thumb.png_base64}`);
      } catch {
        if (!cancelled) {
          setThumbDataUrl(null);
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
        const hits = (await invoke("qdrant_similar_by_path", {
          args: { sourceId: cfg.sourceId, path: filePath, limit: cfg.topK },
        })) as SimilarHit[];
        if (cancelled) return;
        const scoped = hits.filter((h) => isPathSelected(h.file.path, cfg));
        const filtered = scoped.filter((h) => !headerPathExcludeSet.has(h.file.path));
        setSimilar(filtered);
      } catch (e) {
        if (!cancelled) setSimilarError(invokeErrorText(e));
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

  const similarGroups = useMemo(() => groupSimilarByContentHash(similar), [similar]);
  const thumbPathList = useMemo(
    () => similarGroups.map((g) => g.primary.file.path),
    [similarGroups],
  );
  const thumbPathsKey = thumbPathList.join("\0");
  const { thumbByPath, thumbFailedByPath } = useThumbnailsForPaths(thumbPathsKey, thumbPathList);

  function leaveFileView() {
    const dest = locState?.returnTo;
    if (dest) {
      navigate(dest);
      return;
    }
    navigateBackOrFallback(navigate, "/");
  }

  function goBackFromFileResult() {
    if (trail.length > 1) {
      const parent = trail[trail.length - 2]!;
      navigate(`/file?path=${encodeURIComponent(parent)}`, {
        replace: true,
        state: {
          resultStack: trail.slice(0, -1),
          ...(locState?.returnTo != null ? { returnTo: locState.returnTo } : {}),
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
              className="w-fit gap-1 px-2 text-black/60"
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
              className="w-fit gap-1 px-2 text-black/60"
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
        <div className="flex h-24 w-28 shrink-0 items-center justify-center rounded-lg border border-black/10 bg-white/60 shadow-xs">
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
              <span className="text-[10px] font-semibold uppercase tracking-wide text-black/45">
                {fileTypeLabel(filePath)}
              </span>
            )
          ) : (
            <span className="text-[10px] font-semibold uppercase tracking-wide text-black/45">
              {fileTypeLabel(filePath)}
            </span>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col items-start gap-2 pt-0.5">
          {displayPaths.map((p) => (
            <div key={p} className="flex max-w-full items-center gap-2 text-sm">
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="min-w-0 w-fit max-w-full cursor-default truncate rounded-md bg-black/5 px-2 py-1 font-mono text-[12px] text-black/70 sm:max-w-lg">
                    {formatIndexedPathForDisplay(p, homePath, cfg.include)}
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-md break-all font-mono text-xs">
                  {p}
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="shrink-0 text-black/60 hover:text-black"
                    aria-label={`Open ${p}`}
                    onClick={async () => {
                      setOpenError(null);
                      try {
                        await openPath(p);
                      } catch (e) {
                        setOpenError(invokeErrorText(e));
                      }
                    }}
                  >
                    <ExternalLink className="h-4 w-4" aria-hidden />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Open in default app</TooltipContent>
              </Tooltip>
            </div>
          ))}
          <ErrorMessage variant="inline" className="text-xs" message={openError} />

          <div className="mt-3 flex flex-col gap-2">
            <div className="text-xs font-medium uppercase tracking-wide text-black/45">Tags</div>
            {tagsState.tags.length === 0 ? (
              <p className="text-xs text-black/45">Create tags in Settings, then toggle them here.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {tagsState.tags.map((t) => {
                  const active = tagIdsForPath(tagsState, filePath).includes(t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      aria-label={active ? `Remove tag ${t.name}` : `Add tag ${t.name}`}
                      onClick={() => {
                        const next = togglePathTag(tagsState, filePath, t.id);
                        setTagsState(next);
                        saveTagsState(next);
                        void syncPathTagsToQdrant(
                          cfg.sourceId,
                          filePath,
                          tagIdsForPath(next, filePath),
                        ).catch(() => {
                          /* ignore */
                        });
                        if (cfg.autoTaggingEnabled && tagIdsForPath(next, filePath).includes(t.id)) {
                          void runAutoTagOrchestration(cfg, filePath, t.id, next, setTagsState);
                        }
                      }}
                    >
                      <Badge
                        variant={active ? "secondary" : "outline"}
                        className="border font-normal"
                        style={
                          active
                            ? {
                                backgroundColor: `${t.color}24`,
                                borderColor: t.color,
                                color: "inherit",
                              }
                            : undefined
                        }
                      >
                        {t.name}
                      </Badge>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <h2 className="app-muted mb-3 text-xs font-medium uppercase tracking-wide">Similar</h2>
        <ScrollArea className="min-h-0 flex-1 pr-3">
          {similarLoading ? (
            <p className="app-muted text-sm">Loading…</p>
          ) : similarError ? (
            <ErrorMessage variant="inline" className="text-sm" message={similarError} />
          ) : similarGroups.length === 0 ? (
            <p className="app-muted text-sm">No similar files in the current scope.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {similarGroups.map((group) => {
                const hit = group.primary;
                const p = hit.file.path;
                const pExt = p.split(".").pop()?.toLowerCase() ?? "";
                const isPreviewImage = pExt === "png" || pExt === "jpg" || pExt === "jpeg";
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
                        void openPath(p).catch((err) => {
                          setOpenError(invokeErrorText(err));
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
                          ...(locState?.returnTo != null ? { returnTo: locState.returnTo } : {}),
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
                          setTagsState={setTagsState}
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

      <AlertDialog
        open={pathChooserOpen}
        onOpenChange={(open) => {
          setPathChooserOpen(open);
          if (!open) {
            setSelectedSimilarGroup(null);
            setPathChooserOpenInAppMode(false);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pathChooserOpenInAppMode ? "Open in default app" : "Choose file"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pathChooserOpenInAppMode
                ? "These files have identical content. Select the path to open with the system's default application."
                : "These files have identical content. Select the path to continue exploring similar files."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="max-h-64 space-y-2 overflow-y-auto">
            {(selectedSimilarGroup?.variants ?? []).map((variant) => (
              <Tooltip key={variant.file.path}>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-auto w-full justify-start p-0 font-normal hover:bg-transparent focus-visible:bg-transparent"
                    onClick={() => {
                      const p = variant.file.path;
                      const variants = selectedSimilarGroup?.variants ?? [];
                      if (pathChooserOpenInAppMode) {
                        setOpenError(null);
                        void openPath(p).catch((err) => {
                          setOpenError(invokeErrorText(err));
                        });
                      } else {
                        navigate(`/file?path=${encodeURIComponent(p)}`, {
                          state: {
                            resultStack: [...trail, p],
                            sameContentPaths: variants.map((v) => v.file.path),
                            ...(locState?.returnTo != null ? { returnTo: locState.returnTo } : {}),
                          },
                        });
                      }
                      setPathChooserOpen(false);
                      setSelectedSimilarGroup(null);
                      setPathChooserOpenInAppMode(false);
                    }}
                  >
                    <span className="block min-w-0 w-full truncate rounded-md bg-muted px-2 py-1.5 font-mono text-xs text-foreground">
                      {formatIndexedPathForDisplay(variant.file.path, homePath, cfg.include)}
                    </span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-md break-all font-mono text-xs">
                  {variant.file.path}
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
