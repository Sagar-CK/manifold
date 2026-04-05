import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import { SearchPageHeaderActions } from "../components/search/SearchPageHeaderActions";
import { SearchQueryBar } from "../components/search/SearchQueryBar";
import type { MatchTypeFilter } from "../components/search/searchTypes";
import { Button } from "../components/ui/button";
import { ScrollArea } from "../components/ui/scroll-area";
import { ContentHashPathPickerDialog } from "../components/ContentHashPathPickerDialog";
import type { LocalConfig } from "../lib/localConfig";
import { isPathSelected } from "../lib/pathSelection";
import {
  normalizePathKey,
  tagIdsForPath,
  tagsForPath,
} from "../lib/tags";
import { ErrorMessage } from "../components/ErrorMessage";
import { EmbeddingStatusPanel } from "../components/EmbeddingStatusPanel";
import { PageHeader } from "../components/PageHeader";
import { FileSearchResultCard } from "../components/FileSearchResultCard";
import { SearchNoResults } from "../components/SearchNoResults";
import { TagsPathDropdown } from "../components/TagsPathDropdown";
import type { FileResultLocationState } from "./FileResultPage";
import { useEmbeddingStatus } from "@/context/EmbeddingStatusContext";
import { invokeErrorText } from "@/lib/errors";
import { isSearchDebugEnabled, logSearchRun, searchLog } from "@/lib/log";
import { useIndexedPointCount } from "@/lib/qdrantPointCount";
import { useHomeDir } from "@/lib/useHomeDir";
import { useTagsState } from "@/lib/useTagsState";
import { isPreviewablePath, useThumbnailsForPaths } from "@/lib/useThumbnailsForPaths";

function formatSimilarityScore(score: number) {
  if (score >= 0 && score <= 1) return `${(score * 100).toFixed(1)}%`;
  return score.toFixed(4);
}

type SearchResult = {
  score: number;
  matchType: "textMatch" | "semantic";
  file: {
    path: string;
    contentHash: string;
  };
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

export function SearchPage({ cfg }: { cfg: LocalConfig }) {
  const {
    embedding,
    hasPendingEmbeds,
    embeddingPhase,
    embedProgress,
    lastEmbedError,
    embedFailures,
  } = useEmbeddingStatus();
  const [query, setQuery] = useState("");
  const [searchTypeMenuOpen, setSearchTypeMenuOpen] = useState(false);
  const [matchTypeFilter, setMatchTypeFilter] = useState<MatchTypeFilter>(loadMatchTypeFilter);

  useEffect(() => {
    saveMatchTypeFilter(matchTypeFilter);
  }, [matchTypeFilter]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedGroupForOpen, setSelectedGroupForOpen] = useState<SearchResultGroup | null>(null);
  const [pathChooserOpen, setPathChooserOpen] = useState(false);
  const homePath = useHomeDir();
  const [searchThumbnailKey, setSearchThumbnailKey] = useState("");
  const navigate = useNavigate();
  const searchRunSeqRef = useRef(0);
  const latestRunRef = useRef(0);
  const runStartMsRef = useRef(0);
  const fullTextCacheRef = useRef<Record<string, string>>({});
  const [tagsState, setTagsState] = useTagsState();
  const [tagFilterIds, setTagFilterIds] = useState<string[]>(loadTagFilterIds);

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

  const [embeddedCount] = useIndexedPointCount(cfg.sourceId, {
    refetchAfterEmbedSettles: {
      embedding,
      hasPendingEmbeds,
      embeddingPhase,
    },
  });

  const liveIndexedCount =
    embedding || hasPendingEmbeds
      ? Math.max(embeddedCount ?? 0, embedProgress.processed)
      : embeddedCount;

  const searchCfgFingerprint = useMemo(
    () =>
      JSON.stringify({
        sourceId: cfg.sourceId,
        searchMode: cfg.searchMode,
        scoreThreshold: cfg.scoreThreshold,
        topK: cfg.topK,
        include: [...cfg.include].sort(),
        exclude: [...cfg.exclude].sort(),
        useDefaultFolderExcludes: cfg.useDefaultFolderExcludes,
        extensions: [...cfg.extensions].sort(),
        textMatch: matchTypeFilter.textMatch,
        semantic: matchTypeFilter.semantic,
      }),
    [
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
    ],
  );

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
    setSearchThumbnailKey(`${runId}\t${selectedOnly.map((r) => r.file.path).join("\0")}`);
    setIsSearching(false);

    const thumbnailsQueued = selectedOnly.filter((r) =>
      isPreviewablePath(r.file.path),
    ).length;
    logSearchRun(runId, "search completed", {
      totalElapsedMs: Math.round(performance.now() - runStartMsRef.current),
      totalResults: selectedOnly.length,
      thumbnailsQueued,
    });
  }

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setHasSearched(false);
      setIsSearching(false);
      setResults([]);
      setSearchThumbnailKey("");
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
  }, [query, tagFilterIds.length, searchCfgFingerprint]);

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

  const tagFilterSet = useMemo(() => new Set(tagFilterIds), [tagFilterIds]);
  const showingTagBrowse = query.trim() === "" && tagFilterSet.size > 0;
  const pathsForThumbs = useMemo(() => {
    if (showingTagBrowse) return tagBrowseResults.map((r) => r.file.path);
    return results.map((r) => r.file.path);
  }, [showingTagBrowse, tagBrowseResults, results]);

  const thumbPathsKey = useMemo(() => {
    if (showingTagBrowse) {
      return `tag:${tagBrowseResults.map((r) => r.file.path).join("\0")}`;
    }
    return `search:${searchThumbnailKey}`;
  }, [showingTagBrowse, tagBrowseResults, searchThumbnailKey]);

  const { thumbByPath, thumbFailedByPath } = useThumbnailsForPaths(
    thumbPathsKey,
    pathsForThumbs,
    {
      onThumbError: (path, e) => {
        if (thumbPathsKey.startsWith("tag:")) {
          searchLog.warn("tag-browse thumbnail failed", {
            path,
            error: String(e),
          });
          return;
        }
        const rid = latestRunRef.current;
        if (rid > 0) {
          logSearchRun(
            rid,
            "thumbnail generation failed",
            { path, error: String(e) },
            "warn",
          );
        }
      },
    },
  );

  useEffect(() => {
    if (!isSearchDebugEnabled() || latestRunRef.current === 0) return;
    const runId = latestRunRef.current;
    logSearchRun(runId, "results state committed", {
      elapsedMs: Math.round(performance.now() - runStartMsRef.current),
      resultsCount: results.length,
      thumbnailCount: Object.keys(thumbByPath).length,
    });
  }, [results, thumbByPath]);

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
        <SearchPageHeaderActions pendingReviewCount={pendingReviewCount} />
        <PageHeader heading="manifold" subtitle="native indexed file search" />
      </div>

      <SearchQueryBar
        query={query}
        onQueryChange={setQuery}
        searchTypeMenuOpen={searchTypeMenuOpen}
        onSearchTypeMenuOpenChange={setSearchTypeMenuOpen}
        matchTypeFilter={matchTypeFilter}
        onMatchTypeFilterChange={setMatchTypeFilter}
        isSearching={isSearching}
        tagDefs={tagsState.tags}
        tagFilterIds={tagFilterIds}
        onToggleTagFilter={toggleTagFilter}
      />

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

      <ContentHashPathPickerDialog
        open={pathChooserOpen}
        onOpenChange={(open) => {
          setPathChooserOpen(open);
          if (!open) setSelectedGroupForOpen(null);
        }}
        paths={(selectedGroupForOpen?.variants ?? []).map((v) => v.file.path)}
        homePath={homePath}
        includeRoots={cfg.include}
        title="Open in default app"
        description="These files have identical content. Select the path to open with the system's default application."
        onSelectPath={(p) => {
          void openPathInDefaultApp(p);
          setPathChooserOpen(false);
          setSelectedGroupForOpen(null);
        }}
      />

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
