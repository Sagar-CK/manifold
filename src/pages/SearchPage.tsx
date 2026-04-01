import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import { ListFilter, Settings } from "lucide-react";
import { Button } from "../components/ui/button";
import { Spinner } from "../components/ui/spinner";
import { Skeleton } from "../components/ui/skeleton";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "../components/ui/input-group";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
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
import { EmbeddingStatusPanel } from "../components/EmbeddingStatusPanel";
import { PageHeader } from "../components/PageHeader";

function fileTypeLabel(ext: string, mimeType: string) {
  const cleanExt = ext.replace(/^\./, "").trim().toUpperCase();
  if (cleanExt) return cleanExt;
  if (mimeType.includes("pdf")) return "PDF";
  if (mimeType.includes("image/")) return "IMG";
  if (mimeType.includes("text/")) return "TXT";
  return "FILE";
}

function normalizePathForMatch(p: string) {
  // Best-effort cross-platform normalization for prefix checks.
  return p.replace(/\\/g, "/").replace(/\/+$/, "");
}

function isPathSelected(path: string, cfg: LocalConfig) {
  const p = normalizePathForMatch(path);
  const include = cfg.include.map(normalizePathForMatch).filter(Boolean);
  const exclude = cfg.exclude.map(normalizePathForMatch).filter(Boolean);
  const ext = (p.split(".").pop() ?? "").trim().toLowerCase();

  const inInclude =
    include.length === 0 ? true : include.some((root) => p === root || p.startsWith(`${root}/`));
  const inExclude = exclude.some((root) => p === root || p.startsWith(`${root}/`));
  const extSelected = cfg.extensions.length === 0 || cfg.extensions.includes(ext);

  return inInclude && !inExclude && extSelected;
}

function formatSimilarityScore(score: number) {
  if (score >= 0 && score <= 1) return `${(score * 100).toFixed(1)}%`;
  return score.toFixed(4);
}

const SEARCH_DEBUG =
  import.meta.env.DEV ||
  (typeof window !== "undefined" && window.localStorage.getItem("manifold:debug:search") === "1");
const THUMBNAIL_CONCURRENCY = 4;

type SearchResult = {
  score: number;
  matchType: "textMatch" | "semantic";
  file: {
    path: string;
    contentHash: string;
  };
};

type MatchTypeFilter = {
  textMatch: boolean;
  semantic: boolean;
};

type SearchResultGroup = {
  key: string;
  primaryResult: SearchResult;
  variants: SearchResult[];
};

function choosePrimaryResult(a: SearchResult, b: SearchResult) {
  if (a.matchType !== b.matchType) {
    return a.matchType === "textMatch" ? a : b;
  }
  return a.score >= b.score ? a : b;
}

function groupResultsByContentHash(results: SearchResult[]): SearchResultGroup[] {
  const byHash = new Map<string, SearchResultGroup>();
  for (const result of results) {
    const key = result.file.contentHash || result.file.path;
    const existing = byHash.get(key);
    if (!existing) {
      byHash.set(key, { key, primaryResult: result, variants: [result] });
      continue;
    }
    existing.variants.push(result);
    existing.primaryResult = choosePrimaryResult(existing.primaryResult, result);
  }
  return Array.from(byHash.values());
}

export function SearchPage({
  cfg,
  embedding,
  hasPendingEmbeds,
  embeddingPhase,
  embedProgress,
  lastEmbedError,
  embedFailures,
}: {
  cfg: LocalConfig;
  embedding: boolean;
  hasPendingEmbeds: boolean;
  embeddingPhase: "idle" | "scanning" | "embedding" | "paused" | "cancelling" | "done" | "error";
  embedProgress: { processed: number; total: number; status: string };
  lastEmbedError: string | null;
  embedFailures: Array<{ path: string; reason: string }>;
}) {
  const [query, setQuery] = useState("");
  const [searchTypeMenuOpen, setSearchTypeMenuOpen] = useState(false);
  const [matchTypeFilter, setMatchTypeFilter] = useState<MatchTypeFilter>({
    textMatch: true,
    semantic: true,
  });
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [embeddedCount, setEmbeddedCount] = useState<number | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedGroupForOpen, setSelectedGroupForOpen] = useState<SearchResultGroup | null>(null);
  const [pathChooserOpen, setPathChooserOpen] = useState(false);
  const [thumbByPath, setThumbByPath] = useState<Record<string, string>>({});
  const searchRunSeqRef = useRef(0);
  const latestRunRef = useRef(0);
  const runStartMsRef = useRef(0);
  const thumbCacheRef = useRef<Record<string, string>>({});
  const fullTextCacheRef = useRef<Record<string, string>>({});
  const liveIndexedCount =
    embedding || hasPendingEmbeds
      ? Math.max(embeddedCount ?? 0, embedProgress.processed)
      : embeddedCount;

  const logSearch = (
    runId: number,
    message: string,
    data?: Record<string, unknown>,
    level: "debug" | "warn" | "error" = "debug",
  ) => {
    if (!SEARCH_DEBUG && level !== "error") return;
    const prefix = `[search][run:${runId}] ${message}`;
    if (level === "warn") {
      console.warn(prefix, data ?? "");
      return;
    }
    if (level === "error") {
      console.error(prefix, data ?? "");
      return;
    }
    console.debug(prefix, data ?? "");
  };

  useEffect(() => {
    let cancelled = false;
    async function loadCount() {
      try {
        const res = (await invoke("qdrant_count_points", {
          args: { sourceId: cfg.sourceId },
        })) as { count: number } | { count: string };
        const count = typeof res.count === "string" ? Number.parseInt(res.count, 10) : res.count;
        if (!cancelled) setEmbeddedCount(Number.isFinite(count) ? count : 0);
      } catch {
        if (!cancelled) setEmbeddedCount(null);
      }
    }
    void loadCount();
    return () => {
      cancelled = true;
    };
  }, [cfg.sourceId]);

  useEffect(() => {
    // Refresh once the embedding job is no longer running so empty-state text
    // reflects the final indexed count without requiring a route remount.
    if (embedding || hasPendingEmbeds) return;
    if (embeddingPhase !== "done" && embeddingPhase !== "idle" && embeddingPhase !== "error") return;

    let cancelled = false;
    async function refreshCountAfterJobSettles() {
      try {
        const res = (await invoke("qdrant_count_points", {
          args: { sourceId: cfg.sourceId },
        })) as { count: number } | { count: string };
        const count = typeof res.count === "string" ? Number.parseInt(res.count, 10) : res.count;
        if (!cancelled) setEmbeddedCount(Number.isFinite(count) ? count : 0);
      } catch {
        if (!cancelled) setEmbeddedCount(null);
      }
    }

    void refreshCountAfterJobSettles();
    return () => {
      cancelled = true;
    };
  }, [cfg.sourceId, embedding, hasPendingEmbeds, embeddingPhase]);

  async function runSearch(queryText: string) {
    const runId = ++searchRunSeqRef.current;
    latestRunRef.current = runId;
    runStartMsRef.current = performance.now();
    let stageStartMs = performance.now();
    logSearch(runId, "started", {
      queryLength: queryText.length,
      sourceId: cfg.sourceId,
      searchMode: cfg.searchMode,
      topK: cfg.topK,
      scoreThreshold: cfg.scoreThreshold,
      includeCount: cfg.include.length,
      excludeCount: cfg.exclude.length,
      extensionCount: cfg.extensions.length,
    });

    setIsSearching(true);
    setSearchError(null);
    setOpenError(null);

    const searchLimit = cfg.searchMode === "topK" ? cfg.topK : 256;
    let res: SearchResult[];
    try {
      res = (await invoke("hybrid_search", {
        args: {
          sourceId: cfg.sourceId,
          queryText,
          limit: searchLimit,
          searchTypes: [
            ...(matchTypeFilter.textMatch ? ["text"] : []),
            ...(matchTypeFilter.semantic ? ["semantic"] : []),
          ],
        },
      })) as SearchResult[];
      logSearch(runId, "semantic search resolved", {
        elapsedMs: Math.round(performance.now() - stageStartMs),
        rawResultCount: res.length,
        limit: searchLimit,
      });
      stageStartMs = performance.now();
    } catch (e) {
      logSearch(runId, "semantic search failed", { elapsedMs: Math.round(performance.now() - stageStartMs), error: String(e) }, "error");
      if (latestRunRef.current === runId) setIsSearching(false);
      if (latestRunRef.current === runId) {
        setHasSearched(true);
        setSearchError(String(e));
        setResults([]);
      }
      return;
    }
    const filtered =
      cfg.searchMode === "scoreThreshold"
        ? res.filter((r) => r.score >= cfg.scoreThreshold)
        : (() => {
            // Top-K should only cap semantic matches, not text matches.
            let semanticSeen = 0;
            return res.filter((r) => {
              if (r.matchType !== "semantic") return true;
              if (semanticSeen >= cfg.topK) return false;
              semanticSeen += 1;
              return true;
            });
          })();

    // Automatically ignore hits that are outside current selected folders/extensions.
    const selectedOnly = filtered.filter((r) => isPathSelected(r.file.path, cfg));
    logSearch(runId, "post-filter completed", {
      elapsedMs: Math.round(performance.now() - stageStartMs),
      afterModeFilterCount: filtered.length,
      selectedOnlyCount: selectedOnly.length,
      droppedByPathOrExt: filtered.length - selectedOnly.length,
    });
    stageStartMs = performance.now();
    if (latestRunRef.current !== runId) return;
    setHasSearched(true);
    setResults(selectedOnly);
    const cachedThumbsForSelection: Record<string, string> = {};
    for (const r of selectedOnly) {
      const cached = thumbCacheRef.current[r.file.path];
      if (cached) cachedThumbsForSelection[r.file.path] = cached;
    }
    setThumbByPath(cachedThumbsForSelection);
    setIsSearching(false);

    const previewPaths = selectedOnly
      .map((r) => r.file.path)
      .filter((p) => {
        if (thumbCacheRef.current[p]) return false;
        const ext = p.split(".").pop()?.toLowerCase() ?? "";
        return ext === "png" || ext === "jpg" || ext === "jpeg";
      });
    void (async () => {
      const thumbStartMs = performance.now();
      let thumbAttempts = 0;
      let thumbSuccesses = 0;
      let nextIndex = 0;
      const workerCount = Math.min(THUMBNAIL_CONCURRENCY, previewPaths.length);

      const workers = Array.from({ length: workerCount }, async () => {
        while (nextIndex < previewPaths.length) {
          const current = nextIndex;
          nextIndex += 1;
          const p = previewPaths[current];
          thumbAttempts += 1;
          try {
            const thumb = (await invoke("thumbnail_image_base64_png", {
              args: { path: p, max_edge: 96 },
            })) as { png_base64: string };
            const dataUrl = `data:image/png;base64,${thumb.png_base64}`;
            thumbCacheRef.current[p] = dataUrl;
            thumbSuccesses += 1;
            if (latestRunRef.current === runId) {
              setThumbByPath((m) => ({ ...m, [p]: dataUrl }));
            }
          } catch {
            // ignore thumb errors
          }
        }
      });

      await Promise.all(workers);
      logSearch(runId, "thumbnails completed", {
        elapsedMs: Math.round(performance.now() - thumbStartMs),
        attempts: thumbAttempts,
        successes: thumbSuccesses,
        cachedBeforeRun: Object.keys(cachedThumbsForSelection).length,
      });
    })();
    logSearch(runId, "search completed", {
      totalElapsedMs: Math.round(performance.now() - runStartMsRef.current),
      totalResults: selectedOnly.length,
      cachedThumbsUsed: Object.keys(cachedThumbsForSelection).length,
        thumbnailsQueued: previewPaths.length,
    });
  }

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setHasSearched(false);
      setIsSearching(false);
      setResults([]);
      setThumbByPath({});
      return;
    }

    setIsSearching(true);
    const timer = window.setTimeout(() => {
      if (SEARCH_DEBUG) {
        console.debug("[search] debounce fired", {
          queryLength: trimmed.length,
          debounceMs: 250,
          queuedRuns: searchRunSeqRef.current,
        });
      }
      void runSearch(trimmed);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [
    query,
    cfg.sourceId,
    cfg.searchMode,
    cfg.scoreThreshold,
    cfg.topK,
    cfg.include,
    cfg.exclude,
    cfg.extensions,
    matchTypeFilter.textMatch,
    matchTypeFilter.semantic,
  ]);

  useEffect(() => {
    if (!SEARCH_DEBUG || latestRunRef.current === 0) return;
    const runId = latestRunRef.current;
    logSearch(runId, "results state committed", {
      elapsedMs: Math.round(performance.now() - runStartMsRef.current),
      resultsCount: results.length,
      thumbnailCount: Object.keys(thumbByPath).length,
    });
  }, [results, thumbByPath]);

  const typeFilteredResults = results.filter((result) => matchTypeFilter[result.matchType]);
  const groupedResults = groupResultsByContentHash(typeFilteredResults);
  const hasMatchTypeEnabled = matchTypeFilter.textMatch || matchTypeFilter.semantic;

  return (
    <section className="flex min-h-[calc(100dvh-4rem)] flex-col">
      <div className="relative flex flex-col items-center justify-center text-center gap-2 mb-6">
        <Link
          to="/settings"
          className="absolute right-0 top-0 inline-flex h-9 w-9 items-center justify-center rounded-md text-black/70 hover:bg-black/5 hover:text-black"
          aria-label="Open settings"
          title="Settings"
        >
          <Settings className="h-5 w-5" aria-hidden="true" />
        </Link>

        <PageHeader heading="manifold" subtitle="native indexed file search" />
      </div>

      <div className="flex">
        <InputGroup>
          <InputGroupInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search across your files…"
            className="flex-1"
            aria-label="Search query"
          />
          <InputGroupAddon align="inline-end">
            <DropdownMenu open={searchTypeMenuOpen} onOpenChange={setSearchTypeMenuOpen}>
              <DropdownMenuTrigger asChild>
                <InputGroupButton
                  variant={hasMatchTypeEnabled ? "ghost" : "secondary"}
                  size="icon-xs"
                  aria-label="Filter search types"
                >
                  <ListFilter className="size-3.5" />
                </InputGroupButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" onPointerLeave={() => setSearchTypeMenuOpen(false)}>
                <DropdownMenuGroup>
                  <DropdownMenuCheckboxItem
                    checked={matchTypeFilter.textMatch}
                    onSelect={(event) => event.preventDefault()}
                    onCheckedChange={(checked) => {
                      setMatchTypeFilter((current) => {
                        if (checked !== true && !current.semantic) return current;
                        return {
                          ...current,
                          textMatch: checked === true,
                        };
                      });
                    }}
                  >
                    Text match
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={matchTypeFilter.semantic}
                    onSelect={(event) => event.preventDefault()}
                    onCheckedChange={(checked) => {
                      setMatchTypeFilter((current) => {
                        if (checked !== true && !current.textMatch) return current;
                        return {
                          ...current,
                          semantic: checked === true,
                        };
                      });
                    }}
                  >
                    Semantic
                  </DropdownMenuCheckboxItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            {isSearching ? <Spinner className="size-3.5" /> : null}
          </InputGroupAddon>
        </InputGroup>
      </div>

      <div className="mt-5 flex-1">
        {openError ? (
          <div className="mb-3 text-center text-sm font-medium text-rose-700">Open error: {openError}</div>
        ) : null}
        {groupedResults.length === 0 ? (
          !hasSearched ? (
            liveIndexedCount === 0 ? (
              <Link
                to="/settings"
                className="app-muted mx-auto block w-fit underline underline-offset-4 hover:text-black"
              >
                No files indexed yet. Open Settings to add folders.
              </Link>
            ) : null
          ) : searchError ? (
            <div className="text-center text-sm font-medium text-rose-700">
              Search error: {searchError}
            </div>
          ) : !hasMatchTypeEnabled ? (
            <div className="app-muted text-center">
              Enable at least one search type (Text or Semantic).
            </div>
          ) : (
            <div className="app-muted text-center">No results for “{query.trim()}”.</div>
          )
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {groupedResults.map((group) => (
              (() => {
                const r = group.primaryResult;
                const ext = r.file.path.split(".").pop()?.toLowerCase() ?? "";
                const isPreviewImage = ext === "png" || ext === "jpg" || ext === "jpeg";
                const isStacked = group.variants.length > 1;
                return (
              <button
                key={group.key}
                type="button"
                onMouseEnter={() => {
                  if (r.matchType !== "textMatch") return;
                  const cached = fullTextCacheRef.current[r.file.path];
                  if (cached) {
                    console.log("[search][text-match:hover:full-text]", {
                      path: r.file.path,
                      fullText: cached,
                    });
                    return;
                  }
                  void (async () => {
                    try {
                      const fullText = (await invoke("text_index_full_text_for_path", {
                        args: { sourceId: cfg.sourceId, path: r.file.path },
                      })) as string | null;
                      if (!fullText) return;
                      fullTextCacheRef.current[r.file.path] = fullText;
                      console.log("[search][text-match:hover:full-text]", {
                        path: r.file.path,
                        fullText,
                      });
                    } catch (e) {
                      console.warn("[search][text-match:hover:full-text] failed", {
                        path: r.file.path,
                        error: String(e),
                      });
                    }
                  })();
                }}
                onClick={async () => {
                  if (isStacked) {
                    setSelectedGroupForOpen(group);
                    setPathChooserOpen(true);
                    return;
                  }
                  try {
                    setOpenError(null);
                    await openPath(r.file.path);
                  } catch (e) {
                    setOpenError(String(e));
                  }
                }}
                className="group relative flex min-w-0 flex-col items-center gap-2 rounded-lg p-1 transition-opacity hover:opacity-90"
                title={r.file.path}
              >
                {cfg.showSimilarityOnHover ? (
                  <div className="pointer-events-none absolute left-1/2 top-2 w-max -translate-x-1/2 rounded bg-black/75 px-2 py-1 text-[10px] font-medium leading-none tracking-wide text-white opacity-0 transition-opacity group-hover:opacity-100">
                    {r.matchType === "textMatch"
                      ? "Text match"
                      : `Similarity ${formatSimilarityScore(r.score)}`}
                  </div>
                ) : null}
                <div className="w-full px-1">
                  {thumbByPath[r.file.path] ? (
                    <div className="mx-auto flex h-16 w-28 items-center justify-center">
                      <img
                        src={thumbByPath[r.file.path]}
                        className="block max-h-full max-w-full rounded-lg object-contain"
                      />
                    </div>
                  ) : (
                    <div className="mx-auto flex h-16 w-28 items-center justify-center">
                      {isPreviewImage ? (
                        <Skeleton className="h-16 w-28 rounded-lg" />
                      ) : (
                        <div className="flex h-11 w-11 items-center justify-center rounded-md border border-black/10 bg-black/4">
                          <span className="text-[10px] leading-none font-semibold text-black/60 uppercase tracking-wide">
                            {fileTypeLabel(ext, "")}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div className="w-full min-w-0">
                  <div className="truncate text-center text-xs font-normal leading-tight text-black/80">
                    {r.file.path.split("/").pop() ?? r.file.path}
                  </div>
                </div>
              </button>
                );
              })()
            ))}
          </div>
        )}
      </div>

      <AlertDialog
        open={pathChooserOpen}
        onOpenChange={(open) => {
          setPathChooserOpen(open);
          if (!open) setSelectedGroupForOpen(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Choose file to open</AlertDialogTitle>
            <AlertDialogDescription>
              These files have identical content. Select the path you want to view.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="max-h-64 space-y-2 overflow-y-auto">
            {(selectedGroupForOpen?.variants ?? []).map((variant) => (
              <Button
                key={variant.file.path}
                type="button"
                variant="outline"
                className="w-full justify-start truncate"
                onClick={async () => {
                  try {
                    setOpenError(null);
                    await openPath(variant.file.path);
                    setPathChooserOpen(false);
                    setSelectedGroupForOpen(null);
                  } catch (e) {
                    setOpenError(String(e));
                  }
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

      <div className="mt-auto pt-4">
        <div className="flex min-h-24 items-center justify-center">
          <EmbeddingStatusPanel
            embedding={embedding}
            hasPendingEmbeds={hasPendingEmbeds}
            embeddingPhase={embeddingPhase}
            processed={embedProgress.processed}
            total={embedProgress.total}
            lastEmbedError={lastEmbedError}
            embedFailures={embedFailures}
            indexedCount={liveIndexedCount}
          />
        </div>
      </div>
    </section>
  );
}
