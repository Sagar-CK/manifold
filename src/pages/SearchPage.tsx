import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { homeDir } from "@tauri-apps/api/path";
import { openPath } from "@tauri-apps/plugin-opener";
import { ChartScatter, ListChecks, ListFilter, Settings } from "lucide-react";
import { Button } from "../components/ui/button";
import { Spinner } from "../components/ui/spinner";
import { ScrollArea } from "../components/ui/scroll-area";
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
import { formatIndexedPathForDisplay } from "../lib/pathDisplay";
import { isPathSelected } from "../lib/pathSelection";
import {
  loadTagsState,
  normalizePathKey,
  tagIdsForPath,
  tagsForPath,
  type TagsState,
} from "../lib/tags";
import { ErrorMessage } from "../components/ErrorMessage";
import { EmbeddingStatusPanel } from "../components/EmbeddingStatusPanel";
import { PageHeader } from "../components/PageHeader";
import { FileSearchResultCard } from "../components/FileSearchResultCard";
import { SearchNoResults } from "../components/SearchNoResults";
import { TagFilterPill } from "../components/TagFilterPill";
import { TagsPathDropdown } from "../components/TagsPathDropdown";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip";
import type { FileResultLocationState } from "./FileResultPage";
import { invokeErrorText } from "@/lib/errors";
import { isSearchDebugEnabled, logSearchRun, searchLog } from "@/lib/log";

function formatSimilarityScore(score: number) {
  if (score >= 0 && score <= 1) return `${(score * 100).toFixed(1)}%`;
  return score.toFixed(4);
}

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

const MATCH_TYPE_FILTER_KEY = "manifold:search:matchTypeFilter:v1";
const TAG_FILTER_IDS_KEY = "manifold:search:tagFilterIds:v1";

function loadTagFilterIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(TAG_FILTER_IDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string");
  } catch {
    return [];
  }
}

function saveTagFilterIds(ids: string[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TAG_FILTER_IDS_KEY, JSON.stringify(ids));
}

function defaultMatchTypeFilter(): MatchTypeFilter {
  return { textMatch: true, semantic: true };
}

function loadMatchTypeFilter(): MatchTypeFilter {
  if (typeof window === "undefined") return defaultMatchTypeFilter();
  try {
    const raw = window.localStorage.getItem(MATCH_TYPE_FILTER_KEY);
    if (!raw) return defaultMatchTypeFilter();
    const parsed = JSON.parse(raw) as Partial<MatchTypeFilter>;
    const textMatch = typeof parsed.textMatch === "boolean" ? parsed.textMatch : true;
    const semantic = typeof parsed.semantic === "boolean" ? parsed.semantic : true;
    if (!textMatch && !semantic) return defaultMatchTypeFilter();
    return { textMatch, semantic };
  } catch {
    return defaultMatchTypeFilter();
  }
}

function saveMatchTypeFilter(filter: MatchTypeFilter): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(MATCH_TYPE_FILTER_KEY, JSON.stringify(filter));
}

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

async function openPathInDefaultApp(path: string) {
  try {
    await openPath(path);
  } catch (e) {
    searchLog.error("openPath failed", { path, error: String(e) });
  }
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
  const [matchTypeFilter, setMatchTypeFilter] = useState<MatchTypeFilter>(loadMatchTypeFilter);

  useEffect(() => {
    saveMatchTypeFilter(matchTypeFilter);
  }, [matchTypeFilter]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [embeddedCount, setEmbeddedCount] = useState<number | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedGroupForOpen, setSelectedGroupForOpen] = useState<SearchResultGroup | null>(null);
  /** Cmd/Ctrl+click on duplicate-content results: pick which path to open in the default app. */
  const [pathChooserOpen, setPathChooserOpen] = useState(false);
  const [homePath, setHomePath] = useState("");
  const [thumbByPath, setThumbByPath] = useState<Record<string, string>>({});
  const [thumbFailedByPath, setThumbFailedByPath] = useState<Record<string, true>>({});
  const navigate = useNavigate();
  const searchRunSeqRef = useRef(0);
  const latestRunRef = useRef(0);
  const tagBrowseThumbRunSeqRef = useRef(0);
  const runStartMsRef = useRef(0);
  const thumbCacheRef = useRef<Record<string, string>>({});
  const thumbFailedRef = useRef<Record<string, true>>({});
  const fullTextCacheRef = useRef<Record<string, string>>({});
  const [tagsState, setTagsState] = useState<TagsState>(() => loadTagsState());
  const [tagFilterIds, setTagFilterIds] = useState<string[]>(loadTagFilterIds);

  useEffect(() => {
    const onTagsUpdated = () => setTagsState(loadTagsState());
    window.addEventListener("manifold:tags-updated", onTagsUpdated);
    return () => window.removeEventListener("manifold:tags-updated", onTagsUpdated);
  }, []);

  useEffect(() => {
    saveTagFilterIds(tagFilterIds);
  }, [tagFilterIds]);

  useEffect(() => {
    const valid = new Set(tagsState.tags.map((t) => t.id));
    setTagFilterIds((prev) => {
      const next = prev.filter((id) => valid.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [tagsState.tags]);

  const pendingReviewCount = useMemo(() => {
    let n = 0;
    for (const ids of Object.values(tagsState.pendingAutoTags)) {
      if (ids?.length) n += ids.length;
    }
    return n;
  }, [tagsState.pendingAutoTags]);

  const liveIndexedCount =
    embedding || hasPendingEmbeds
      ? Math.max(embeddedCount ?? 0, embedProgress.processed)
      : embeddedCount;

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
    logSearchRun(runId, "started", {
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
      logSearchRun(runId, "semantic search resolved", {
        elapsedMs: Math.round(performance.now() - stageStartMs),
        rawResultCount: res.length,
        limit: searchLimit,
      });
      stageStartMs = performance.now();
    } catch (e) {
      logSearchRun(runId, "semantic search failed", { elapsedMs: Math.round(performance.now() - stageStartMs), error: invokeErrorText(e) }, "error");
      if (latestRunRef.current === runId) setIsSearching(false);
      if (latestRunRef.current === runId) {
        setHasSearched(true);
        setSearchError(invokeErrorText(e));
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
    logSearchRun(runId, "post-filter completed", {
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
    const failedThumbsForSelection: Record<string, true> = {};
    for (const r of selectedOnly) {
      const cached = thumbCacheRef.current[r.file.path];
      if (cached) cachedThumbsForSelection[r.file.path] = cached;
      if (thumbFailedRef.current[r.file.path]) failedThumbsForSelection[r.file.path] = true;
    }
    setThumbByPath(cachedThumbsForSelection);
    setThumbFailedByPath(failedThumbsForSelection);
    setIsSearching(false);

    const previewPaths = selectedOnly
      .map((r) => r.file.path)
      .filter((p) => {
        if (thumbCacheRef.current[p]) return false;
        if (thumbFailedRef.current[p]) return false;
        const ext = p.split(".").pop()?.toLowerCase() ?? "";
        return ext === "png" || ext === "jpg" || ext === "jpeg" || ext === "pdf";
      });
    void (async () => {
      const thumbStartMs = performance.now();
      let thumbAttempts = 0;
      let thumbSuccesses = 0;
      let nextIndex = 0;
      const workerCount = Math.min(THUMBNAIL_CONCURRENCY, previewPaths.length);

      const workers = Array.from({ length: workerCount }, async () => {
        while (nextIndex < previewPaths.length) {
          if (latestRunRef.current !== runId) return;
          const current = nextIndex;
          nextIndex += 1;
          const p = previewPaths[current];
          thumbAttempts += 1;
          try {
            const thumb = (await invoke("thumbnail_image_base64_png", {
              args: { path: p, max_edge: 96, page: 0 },
            })) as { png_base64: string };
            const dataUrl = `data:image/png;base64,${thumb.png_base64}`;
            thumbCacheRef.current[p] = dataUrl;
            delete thumbFailedRef.current[p];
            thumbSuccesses += 1;
            if (latestRunRef.current === runId) {
              setThumbByPath((m) => ({ ...m, [p]: dataUrl }));
              setThumbFailedByPath((m) => {
                if (!m[p]) return m;
                const next = { ...m };
                delete next[p];
                return next;
              });
            }
          } catch (e) {
            thumbFailedRef.current[p] = true;
            logSearchRun(
              runId,
              "thumbnail generation failed",
              {
                path: p,
                error: String(e),
              },
              "warn",
            );
            if (latestRunRef.current === runId) {
              setThumbFailedByPath((m) => ({ ...m, [p]: true }));
            }
          }
        }
      });

      await Promise.all(workers);
      logSearchRun(runId, "thumbnails completed", {
        elapsedMs: Math.round(performance.now() - thumbStartMs),
        attempts: thumbAttempts,
        successes: thumbSuccesses,
        cachedBeforeRun: Object.keys(cachedThumbsForSelection).length,
      });
    })();
    logSearchRun(runId, "search completed", {
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
      if (tagFilterIds.length === 0) {
        setThumbByPath({});
        setThumbFailedByPath({});
      }
      return;
    }

    setIsSearching(true);
    const timer = window.setTimeout(() => {
      searchLog.debug("debounce fired", {
        queryLength: trimmed.length,
        debounceMs: 250,
        queuedRuns: searchRunSeqRef.current,
      });
      void runSearch(trimmed);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [
    query,
    tagFilterIds.length,
    cfg.sourceId,
    cfg.searchMode,
    cfg.scoreThreshold,
    cfg.topK,
    cfg.include,
    cfg.exclude,
    cfg.useDefaultFolderExcludes,
    cfg.extensions,
    matchTypeFilter.textMatch,
    matchTypeFilter.semantic,
  ]);

  const tagBrowseResults = useMemo((): SearchResult[] => {
    const trimmed = query.trim();
    if (trimmed !== "" || tagFilterIds.length === 0) return [];
    const filterSet = new Set(tagFilterIds);
    const seen = new Set<string>();
    const out: SearchResult[] = [];
    for (const [p, ids] of Object.entries(tagsState.pathToTagIds)) {
      if (!ids.some((id) => filterSet.has(id))) continue;
      if (!isPathSelected(p, cfg)) continue;
      const nk = normalizePathKey(p);
      if (seen.has(nk)) continue;
      seen.add(nk);
      out.push({
        score: 1,
        matchType: "semantic",
        file: { path: p, contentHash: "" },
      });
    }
    out.sort((a, b) => a.file.path.localeCompare(b.file.path));
    return out;
  }, [query, tagFilterIds, tagsState.pathToTagIds, cfg]);

  useEffect(() => {
    if (tagBrowseResults.length === 0) return;
    const runId = ++tagBrowseThumbRunSeqRef.current;
    const paths = tagBrowseResults.map((r) => r.file.path);

    const cachedThumbsForSelection: Record<string, string> = {};
    const failedThumbsForSelection: Record<string, true> = {};
    for (const p of paths) {
      const cached = thumbCacheRef.current[p];
      if (cached) cachedThumbsForSelection[p] = cached;
      if (thumbFailedRef.current[p]) failedThumbsForSelection[p] = true;
    }
    setThumbByPath(cachedThumbsForSelection);
    setThumbFailedByPath(failedThumbsForSelection);

    const previewPaths = paths.filter((p) => {
      if (thumbCacheRef.current[p]) return false;
      if (thumbFailedRef.current[p]) return false;
      const ext = p.split(".").pop()?.toLowerCase() ?? "";
      return ext === "png" || ext === "jpg" || ext === "jpeg" || ext === "pdf";
    });

    void (async () => {
      let nextIndex = 0;
      const workerCount = Math.min(THUMBNAIL_CONCURRENCY, previewPaths.length);
      const workers = Array.from({ length: workerCount }, async () => {
        while (nextIndex < previewPaths.length) {
          if (tagBrowseThumbRunSeqRef.current !== runId) return;
          const current = nextIndex;
          nextIndex += 1;
          const p = previewPaths[current];
          try {
            const thumb = (await invoke("thumbnail_image_base64_png", {
              args: { path: p, max_edge: 96, page: 0 },
            })) as { png_base64: string };
            const dataUrl = `data:image/png;base64,${thumb.png_base64}`;
            thumbCacheRef.current[p] = dataUrl;
            delete thumbFailedRef.current[p];
            if (tagBrowseThumbRunSeqRef.current === runId) {
              setThumbByPath((m) => ({ ...m, [p]: dataUrl }));
              setThumbFailedByPath((m) => {
                if (!m[p]) return m;
                const next = { ...m };
                delete next[p];
                return next;
              });
            }
          } catch (e) {
            thumbFailedRef.current[p] = true;
            searchLog.warn("tag-browse thumbnail failed", { path: p, error: String(e) });
            if (tagBrowseThumbRunSeqRef.current === runId) {
              setThumbFailedByPath((m) => ({ ...m, [p]: true }));
            }
          }
        }
      });
      await Promise.all(workers);
    })();
  }, [tagBrowseResults]);

  useEffect(() => {
    if (!isSearchDebugEnabled() || latestRunRef.current === 0) return;
    const runId = latestRunRef.current;
    logSearchRun(runId, "results state committed", {
      elapsedMs: Math.round(performance.now() - runStartMsRef.current),
      resultsCount: results.length,
      thumbnailCount: Object.keys(thumbByPath).length,
    });
  }, [results, thumbByPath]);

  const tagFilterSet = new Set(tagFilterIds);
  const showingTagBrowse = query.trim() === "" && tagFilterSet.size > 0;
  const sourceResults = showingTagBrowse ? tagBrowseResults : results;
  const typeFilteredResults = showingTagBrowse
    ? sourceResults
    : sourceResults.filter((result) => matchTypeFilter[result.matchType]);
  const tagFilteredResults =
    showingTagBrowse
      ? sourceResults
      : tagFilterSet.size === 0
        ? typeFilteredResults
        : typeFilteredResults.filter((r) => {
            const ids = tagIdsForPath(tagsState, r.file.path);
            return ids.some((id) => tagFilterSet.has(id));
          });
  const groupedResults = groupResultsByContentHash(tagFilteredResults);
  const hasMatchTypeEnabled = matchTypeFilter.textMatch || matchTypeFilter.semantic;
  const hasTagFilterButNoMatches =
    hasSearched &&
    tagFilterSet.size > 0 &&
    typeFilteredResults.length > 0 &&
    tagFilteredResults.length === 0;

  function toggleTagFilter(id: string) {
    setTagFilterIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  return (
    <section className="flex h-full min-h-0 flex-col">
      <div className="relative flex flex-col items-center justify-center text-center gap-2 mb-6">
        <div className="absolute right-0 top-0 flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="relative text-muted-foreground"
                asChild
              >
                <Link
                  to="/review-tags"
                  aria-label={
                    pendingReviewCount > 0
                      ? `Review ${pendingReviewCount} suggested tag${pendingReviewCount === 1 ? "" : "s"}`
                      : "Review suggested tags"
                  }
                >
                  <ListChecks className="h-5 w-5" aria-hidden="true" />
                  {pendingReviewCount > 0 ? (
                    <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-orange-500 px-1 text-[10px] font-semibold leading-none text-white">
                      {pendingReviewCount > 99 ? "99+" : pendingReviewCount}
                    </span>
                  ) : null}
                </Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Review suggested tags</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="text-muted-foreground" asChild>
                <Link to="/graph" aria-label="Open graph explorer">
                  <ChartScatter className="h-5 w-5" aria-hidden="true" />
                </Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Graph explorer</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="text-muted-foreground" asChild>
                <Link to="/settings" aria-label="Open settings">
                  <Settings className="h-5 w-5" aria-hidden="true" />
                </Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Settings</TooltipContent>
          </Tooltip>
        </div>

        <PageHeader heading="manifold" subtitle="native indexed file search" />
      </div>

      <div className="flex w-full flex-col">
        <InputGroup className="w-full">
          <InputGroupInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search across your files…"
            className="flex-1"
            aria-label="Search query"
          />
          <InputGroupAddon align="inline-end">
            <DropdownMenu open={searchTypeMenuOpen} onOpenChange={setSearchTypeMenuOpen}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <DropdownMenuTrigger asChild>
                      <InputGroupButton
                        variant={hasMatchTypeEnabled ? "ghost" : "secondary"}
                        size="icon-xs"
                        aria-label="Filter search types"
                      >
                        <ListFilter className="size-3.5" />
                      </InputGroupButton>
                    </DropdownMenuTrigger>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom">Filter search types</TooltipContent>
              </Tooltip>
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
        {tagsState.tags.length > 0 ? (
          <div className="mt-2 w-full text-center">
            <div className="inline-flex max-w-full flex-wrap items-center justify-center gap-2">
            {tagsState.tags.map((t) => {
              const on = tagFilterIds.includes(t.id);
              return (
                <TagFilterPill
                  key={t.id}
                  tag={t}
                  pressed={on}
                  onPressedChange={() => toggleTagFilter(t.id)}
                  ariaLabel={`Filter by tag ${t.name}`}
                />
              );
            })}
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-5 min-h-0 flex-1">
        <ScrollArea className="h-full pr-3">
          {groupedResults.length === 0 ? (
            showingTagBrowse ? (
              <SearchNoResults variant="tag-filters" />
            ) : !hasSearched ? (
              liveIndexedCount === 0 ? (
                <div className="flex w-full justify-center">
                  <Button variant="link" className="app-muted h-auto p-0" asChild>
                    <Link to="/settings" className="underline underline-offset-4 hover:text-foreground">
                      No files indexed yet. Open Settings to add folders.
                    </Link>
                  </Button>
                </div>
              ) : null
            ) : searchError ? (
              <ErrorMessage variant="centered" title="Search error" message={searchError} />
            ) : !hasMatchTypeEnabled ? (
              <div className="app-muted text-center">
                Enable at least one search type (Text or Semantic).
              </div>
            ) : hasTagFilterButNoMatches ? (
              <SearchNoResults variant="tag-filters" />
            ) : (
              <SearchNoResults variant="query" query={query} />
            )
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {groupedResults.map((group) => {
                const r = group.primaryResult;
                const ext = r.file.path.split(".").pop()?.toLowerCase() ?? "";
                const isPreviewImage = ext === "png" || ext === "jpg" || ext === "jpeg";
                const isPreviewFile = isPreviewImage || ext === "pdf";
                const isStacked = group.variants.length > 1;
                return (
                  <FileSearchResultCard
                    key={group.key}
                    path={r.file.path}
                    onMouseEnter={() => {
                      if (r.matchType !== "textMatch") return;
                      const cached = fullTextCacheRef.current[r.file.path];
                      if (cached) {
                        searchLog.debug("text-match:hover:full-text", {
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
                          searchLog.debug("text-match:hover:full-text", {
                            path: r.file.path,
                            fullText,
                          });
                        } catch (e) {
                          searchLog.warn("text-match:hover:full-text failed", {
                            path: r.file.path,
                            error: String(e),
                          });
                        }
                      })();
                    }}
                    onClick={(e) => {
                      const openInApp = e.metaKey || e.ctrlKey;
                      if (openInApp) {
                        e.preventDefault();
                        if (isStacked) {
                          setSelectedGroupForOpen(group);
                          setPathChooserOpen(true);
                          return;
                        }
                        void openPathInDefaultApp(r.file.path);
                        return;
                      }
                      navigate(`/file?path=${encodeURIComponent(r.file.path)}`, {
                        state: {
                          returnTo: "/",
                          ...(isStacked
                            ? {
                                sameContentPaths: group.variants.map((v) => v.file.path),
                              }
                            : {}),
                        } satisfies FileResultLocationState,
                      });
                    }}
                    thumbUrl={thumbByPath[r.file.path] ?? null}
                    thumbFailed={!!thumbFailedByPath[r.file.path]}
                    thumbExpectLoading={isPreviewFile && !thumbFailedByPath[r.file.path]}
                    hoverChip={
                      showingTagBrowse
                        ? null
                        : cfg.showSimilarityOnHover
                          ? r.matchType === "textMatch"
                            ? "Text match"
                            : `Similarity ${formatSimilarityScore(r.score)}`
                          : null
                    }
                    tagDots={tagsForPath(tagsState, r.file.path)}
                    tagMenuSlot={
                      tagsState.tags.length > 0 ? (
                        <TagsPathDropdown
                          path={r.file.path}
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
          if (!open) setSelectedGroupForOpen(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Open in default app</AlertDialogTitle>
            <AlertDialogDescription>
              These files have identical content. Select the path to open with the system&apos;s default
              application.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="max-h-64 space-y-2 overflow-y-auto">
            {(selectedGroupForOpen?.variants ?? []).map((variant) => (
              <Tooltip key={variant.file.path}>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-auto w-full justify-start p-0 font-normal hover:bg-transparent focus-visible:bg-transparent"
                    onClick={() => {
                      void openPathInDefaultApp(variant.file.path);
                      setPathChooserOpen(false);
                      setSelectedGroupForOpen(null);
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
