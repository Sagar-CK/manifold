import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { FileSearchResultCard } from "../components/FileSearchResultCard";
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
import type { LocalConfig } from "../lib/localConfig";
import { isPathSelected } from "../lib/pathSelection";
import { useThumbnailsForPaths } from "../lib/useThumbnailsForPaths";

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
  similarTrail?: string[];
};

export function FileResultPage({ cfg }: { cfg: LocalConfig }) {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const rawPath = searchParams.get("path");
  const filePath = rawPath ? decodeURIComponent(rawPath) : null;

  const [thumbDataUrl, setThumbDataUrl] = useState<string | null>(null);
  const [thumbLoading, setThumbLoading] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);

  const [trail, setTrail] = useState<string[]>([]);
  const [similar, setSimilar] = useState<SimilarHit[]>([]);
  const [similarLoading, setSimilarLoading] = useState(false);
  const [similarError, setSimilarError] = useState<string | null>(null);
  const [pathChooserOpen, setPathChooserOpen] = useState(false);
  const [selectedSimilarGroup, setSelectedSimilarGroup] = useState<SimilarGroup | null>(null);

  const ext = filePath?.split(".").pop()?.toLowerCase() ?? "";
  const canThumb = ext === "png" || ext === "jpg" || ext === "jpeg" || ext === "pdf";

  useEffect(() => {
    if (!filePath) {
      setTrail([]);
      return;
    }
    const st = location.state as FileResultLocationState | undefined;
    const fromState = st?.similarTrail;
    if (fromState?.length && fromState[fromState.length - 1] === filePath) {
      setTrail(fromState);
      return;
    }
    setTrail([filePath]);
  }, [filePath, location.key]);

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
          args: { sourceId: cfg.sourceId, path: filePath, limit: 32 },
        })) as SimilarHit[];
        if (cancelled) return;
        const scoped = hits.filter((h) => isPathSelected(h.file.path, cfg));
        const filtered = scoped.filter((h) => h.file.path !== filePath);
        setSimilar(filtered);
      } catch (e) {
        if (!cancelled) setSimilarError(String(e));
      } finally {
        if (!cancelled) setSimilarLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [filePath, cfg.sourceId, cfg.include, cfg.exclude, cfg.extensions, cfg.useDefaultFolderExcludes]);

  const similarGroups = useMemo(() => groupSimilarByContentHash(similar), [similar]);
  const thumbPathList = useMemo(
    () => similarGroups.map((g) => g.primary.file.path),
    [similarGroups],
  );
  const thumbPathsKey = thumbPathList.join("\0");
  const { thumbByPath, thumbFailedByPath } = useThumbnailsForPaths(thumbPathsKey, thumbPathList);

  if (!filePath) {
    return (
      <section className="flex min-h-0 flex-1 flex-col gap-6">
        <Link
          to="/"
          className="app-muted inline-flex w-fit items-center gap-1 text-sm hover:text-black/80"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Back
        </Link>
        <p className="app-muted text-sm">No file selected.</p>
      </section>
    );
  }

  return (
    <section className="flex h-full min-h-0 flex-1 flex-col gap-6">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
        <Link
          to="/"
          className="app-muted inline-flex items-center gap-1 text-sm hover:text-black/80"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Back
        </Link>
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto p-0 text-sm font-normal"
          onClick={async () => {
            setOpenError(null);
            try {
              await openPath(filePath);
            } catch (e) {
              setOpenError(String(e));
            }
          }}
        >
          Open file
        </Button>
      </div>

      {openError ? <p className="app-muted text-sm">{openError}</p> : null}

      {trail.length > 1 ? (
        <nav
          className="flex flex-wrap items-center gap-x-1 gap-y-1 text-xs text-black/55"
          aria-label="Similar trail"
        >
          {trail.map((p, i) => (
            <span key={`${p}\u0000${i}`} className="flex min-w-0 max-w-full items-center gap-1">
              {i > 0 ? <ChevronRight className="size-3 shrink-0 opacity-40" aria-hidden /> : null}
              <button
                type="button"
                className={
                  p === filePath
                    ? "min-w-0 max-w-[min(100%,14rem)] truncate text-left font-medium text-black/70"
                    : "min-w-0 max-w-[min(100%,14rem)] truncate text-left hover:text-black/80 hover:underline"
                }
                title={p}
                onClick={() => {
                  if (p === filePath) return;
                  const nextTrail = trail.slice(0, i + 1);
                  navigate(`/file?path=${encodeURIComponent(p)}`, {
                    state: { similarTrail: nextTrail },
                  });
                }}
              >
                {p.split("/").pop() ?? p}
              </button>
            </span>
          ))}
        </nav>
      ) : null}

      <p
        className="break-all font-mono text-sm leading-relaxed text-black/80"
        title={filePath}
      >
        {filePath}
      </p>

      <div className="flex min-h-[5rem] w-full max-w-[7rem] items-center justify-center">
        {canThumb ? (
          thumbDataUrl ? (
            <img
              src={thumbDataUrl}
              alt=""
              className="max-h-20 max-w-full rounded-md object-contain"
            />
          ) : thumbLoading ? (
            <Skeleton className="h-16 w-28 rounded-md" />
          ) : (
            <span className="text-[10px] font-semibold uppercase tracking-wide text-black/50">
              {fileTypeLabel(filePath)}
            </span>
          )
        ) : (
          <span className="text-[10px] font-semibold uppercase tracking-wide text-black/50">
            {fileTypeLabel(filePath)}
          </span>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <h2 className="app-muted mb-3 text-xs font-medium uppercase tracking-wide">Similar</h2>
        <ScrollArea className="min-h-0 flex-1 pr-3">
          {similarLoading ? (
            <p className="app-muted text-sm">Loading…</p>
          ) : similarError ? (
            <p className="app-muted text-sm">{similarError}</p>
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
                    onClick={() => {
                      if (isStacked) {
                        setSelectedSimilarGroup(group);
                        setPathChooserOpen(true);
                        return;
                      }
                      navigate(`/file?path=${encodeURIComponent(p)}`, {
                        state: { similarTrail: [...trail, p] },
                      });
                    }}
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
          if (!open) setSelectedSimilarGroup(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Choose file</AlertDialogTitle>
            <AlertDialogDescription>
              These files have identical content. Select the path to continue exploring similar files.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="max-h-64 space-y-2 overflow-y-auto">
            {(selectedSimilarGroup?.variants ?? []).map((variant) => (
              <Button
                key={variant.file.path}
                type="button"
                variant="outline"
                className="w-full justify-start truncate"
                onClick={() => {
                  const p = variant.file.path;
                  navigate(`/file?path=${encodeURIComponent(p)}`, {
                    state: { similarTrail: [...trail, p] },
                  });
                  setPathChooserOpen(false);
                  setSelectedSimilarGroup(null);
                }}
                title={variant.file.path}
              >
                {variant.file.path}
              </Button>
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
