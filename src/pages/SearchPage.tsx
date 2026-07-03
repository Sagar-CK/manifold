import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AppAlert } from "@/components/app/AppAlert";
import { EmbeddingStatusPanel } from "@/components/app/EmbeddingStatusPanel";
import { PageHeader } from "@/components/app/PageHeader";
import { PageHeaderNav } from "@/components/app/PageHeaderNav";
import { ContentHashPathPickerDialog } from "@/components/files/ContentHashPathPickerDialog";
import { FileSearchResultCard } from "@/components/files/FileSearchResultCard";
import { useEmbeddingStatus } from "@/context/EmbeddingStatusContext";
import { SearchQueryBar } from "@/features/search/components/SearchQueryBar";
import {
  hybridSearch,
  type SearchHit,
  textIndexFullTextForPath,
} from "@/lib/api/desktop";
import type { LocalConfig } from "@/lib/config/localConfig";
import { invokeErrorText } from "@/lib/errors";
import { formatSimilarityScore, openPathInDefaultApp } from "@/lib/files";
import { isPathSelected } from "@/lib/files/pathSelection";
import { pruneIndexedPathIfMissing } from "@/lib/files/staleIndexedPaths";
import { useThumbnailsForPaths } from "@/lib/files/useThumbnailsForPaths";
import { formatSearchResultsForLog, logSearchRun, searchLog } from "@/lib/log";
import { groupByContentHash } from "@/lib/search/resultGrouping";
import { normalizeForMatch } from "@/lib/search/textMatchNormalize";
import { useIndexedPointCount } from "@/lib/search/useIndexedPointCount";
import { useHomeDir } from "@/lib/system/useHomeDir";
import { useTagsState } from "@/lib/tags/useTagsState";
import { Button } from "../components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "../components/ui/empty";
import { ScrollArea } from "../components/ui/scroll-area";
import { normalizePathKey, tagIdsForPath, tagsForPath } from "../lib/tags";
import type { FileResultLocationState } from "./FileResultPage";
import { useStoredSearchFilters } from "./search/useStoredSearchFilters";

type SearchResult = SearchHit;

type SearchResultGroup = {
  key: string;
  primaryResult: SearchResult;
  variants: SearchResult[];
};

function matchTypeRank(m: SearchResult["matchType"]): number {
  switch (m) {
    case "text":
      return 3;
    case "ocr":
      return 2;
    case "semantic":
      return 1;
    default:
      return 0;
  }
}

function choosePrimaryResult(a: SearchResult, b: SearchResult): SearchResult {
  const ra = matchTypeRank(a.matchType);
  const rb = matchTypeRank(b.matchType);
  if (ra !== rb) return ra > rb ? a : b;
  return a.score >= b.score ? a : b;
}

function normalizedTerms(value: string): string[] {
  return normalizeForMatch(value)
    .split(/\s+/)
    .filter((term) => term.length > 0);
}

function normalizedTextContainsTerms(value: string, terms: readonly string[]) {
  if (terms.length === 0) return false;
  const words = new Set(normalizedTerms(value));
  if (terms.every((term) => words.has(term))) return true;
  return normalizeForMatch(value).replace(/\s+/g, "").includes(terms.join(""));
}

function shouldOpenPdfTextPreview(params: {
  fullText: string | undefined;
  path: string;
  query: string;
}) {
  const terms = normalizedTerms(params.query);
  if (!params.fullText || terms.length === 0) return false;
  const bodyText = params.fullText.replace(/^filename:.*$/im, "");
  if (normalizedTextContainsTerms(bodyText, terms)) return true;
  return !normalizedTextContainsTerms(params.path, terms);
}

export function SearchPage({ cfg }: { cfg: LocalConfig }) {
  const {
    embedding,
    hasPendingEmbeds,
    embeddingPhase,
    embedProgress,
    lastEmbedError,
    embedFailures,
    ignoreEmbedFailure,
    retryEmbedding,
  } = useEmbeddingStatus();
  const [query, setQuery] = useState("");
  const {
    matchTypeFilter,
    setMatchTypeFilter,
    tagFilterIds,
    setTagFilterIds,
    fileTypeFilter,
    setFileTypeFilter,
  } = useStoredSearchFilters();
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedGroupForOpen, setSelectedGroupForOpen] =
    useState<SearchResultGroup | null>(null);
  const [pathChooserOpen, setPathChooserOpen] = useState(false);
  const homePath = useHomeDir();
  const [searchThumbnailKey, setSearchThumbnailKey] = useState("");
  const navigate = useNavigate();
  const searchRunSeqRef = useRef(0);
  const latestRunRef = useRef(0);
  const runStartMsRef = useRef(0);
  const fullTextCacheRef = useRef<Record<string, string>>({});
  const [tagsState] = useTagsState();

  useEffect(() => {
    const valid = new Set(tagsState.tags.map((t) => t.id));
    setTagFilterIds((prev) => {
      const next = prev.filter((id) => valid.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [tagsState.tags]);

  useEffect(() => {
    const valid = new Set(cfg.extensions.map((ext) => ext.toLowerCase()));
    setFileTypeFilter((prev) => {
      const next = prev.filter((ext) => valid.has(ext));
      return next.length === prev.length ? prev : next;
    });
  }, [cfg.extensions]);

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
        defaultFolderExcludeSegments: [
          ...cfg.defaultFolderExcludeSegments,
        ].sort(),
        extensions: [...cfg.extensions].sort(),
        text: matchTypeFilter.text,
        ocr: matchTypeFilter.ocr,
        semantic: matchTypeFilter.semantic,
        fileTypes: [...fileTypeFilter].sort(),
      }),
    [
      cfg.sourceId,
      cfg.searchMode,
      cfg.scoreThreshold,
      cfg.topK,
      cfg.include,
      cfg.exclude,
      cfg.useDefaultFolderExcludes,
      cfg.defaultFolderExcludeSegments,
      cfg.extensions,
      matchTypeFilter.text,
      matchTypeFilter.ocr,
      matchTypeFilter.semantic,
      fileTypeFilter,
    ],
  );

  async function runSearch(queryText: string) {
    const runId = ++searchRunSeqRef.current;
    latestRunRef.current = runId;
    runStartMsRef.current = performance.now();

    setIsSearching(true);
    setSearchError(null);

    const searchLimit = 256;
    let res: SearchResult[];
    try {
      res = await hybridSearch({
        sourceId: cfg.sourceId,
        queryText,
        limit: searchLimit,
        searchTypes: [
          ...(matchTypeFilter.text ? ["text"] : []),
          ...(matchTypeFilter.ocr ? ["ocr"] : []),
          ...(matchTypeFilter.semantic ? ["semantic"] : []),
        ],
      });
    } catch (e) {
      logSearchRun(
        runId,
        `"${queryText}" failed`,
        {
          elapsedMs: Math.round(performance.now() - runStartMsRef.current),
          error: invokeErrorText(e),
        },
        "error",
      );
      if (latestRunRef.current === runId) setIsSearching(false);
      if (latestRunRef.current === runId) {
        setHasSearched(true);
        setSearchError(invokeErrorText(e));
        setResults([]);
      }
      return;
    }
    // Search can return high-ranking hits outside the current folder/extension scope.
    // Filter those before applying Top-K so in-scope files are not hidden behind
    // out-of-scope neighbors.
    const selectedFileTypes = new Set(fileTypeFilter);
    const resultMatchesFileType = (path: string) => {
      if (selectedFileTypes.size === 0) return true;
      const ext = (path.split(".").pop() ?? "").trim().toLowerCase();
      return selectedFileTypes.has(ext);
    };
    const selectedCandidates = res.filter(
      (r) =>
        isPathSelected(r.file.path, cfg) && resultMatchesFileType(r.file.path),
    );
    const filtered =
      cfg.searchMode === "scoreThreshold"
        ? selectedCandidates.filter((r) => r.score >= cfg.scoreThreshold)
        : (() => {
            // Top-K should only cap semantic matches, not text matches.
            let semanticSeen = 0;
            return selectedCandidates.filter((r) => {
              if (r.matchType !== "semantic") return true;
              if (semanticSeen >= cfg.topK) return false;
              semanticSeen += 1;
              return true;
            });
          })();

    if (latestRunRef.current !== runId) return;
    setHasSearched(true);
    setResults(filtered);
    setSearchThumbnailKey(
      `${runId}\t${filtered.map((r) => r.file.path).join("\0")}`,
    );
    setIsSearching(false);

    logSearchRun(runId, `"${queryText}" → ${filtered.length} results`, {
      elapsedMs: Math.round(performance.now() - runStartMsRef.current),
      searchMode: cfg.searchMode,
      limit: searchLimit,
      rawCount: res.length,
      afterModeFilter: filtered.length,
      droppedByPathOrExt: res.length - selectedCandidates.length,
      fileTypeFilter,
      results: formatSearchResultsForLog(filtered, {
        homePath,
        includeRoots: cfg.include,
      }),
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
      if (fileTypeFilter.length > 0) {
        const ext = (p.split(".").pop() ?? "").trim().toLowerCase();
        if (!fileTypeFilter.includes(ext)) continue;
      }
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
  }, [query, tagFilterIds, tagsState.pathToTagIds, cfg, fileTypeFilter]);

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
        void pruneIndexedPathIfMissing(cfg.sourceId, path, e).catch(
          (cleanup) => {
            searchLog.warn("search stale thumbnail cleanup failed", {
              path,
              error: invokeErrorText(cleanup),
            });
          },
        );
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

  const sourceResults = showingTagBrowse ? tagBrowseResults : results;
  const typeFilteredResults = showingTagBrowse
    ? sourceResults
    : sourceResults.filter((result) => matchTypeFilter[result.matchType]);
  const tagFilteredResults = showingTagBrowse
    ? sourceResults
    : tagFilterSet.size === 0
      ? typeFilteredResults
      : typeFilteredResults.filter((r) => {
          const ids = tagIdsForPath(tagsState, r.file.path);
          return ids.some((id) => tagFilterSet.has(id));
        });
  const groupedResults: SearchResultGroup[] = groupByContentHash(
    tagFilteredResults,
    choosePrimaryResult,
  ).map((group) => ({
    key: group.key,
    primaryResult: group.primary,
    variants: group.variants,
  }));
  const hasMatchTypeEnabled =
    matchTypeFilter.text || matchTypeFilter.ocr || matchTypeFilter.semantic;
  const availableSearchFileTypes = cfg.extensions
    .map((ext) => ext.toLowerCase())
    .filter((ext, index, arr) => ext && arr.indexOf(ext) === index)
    .sort((a, b) => a.localeCompare(b));
  function toggleTagFilter(id: string) {
    setTagFilterIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  return (
    <section className="flex h-full min-h-0 flex-col">
      <div className="relative flex flex-col items-center justify-center gap-2 text-center">
        <PageHeaderNav />
        <PageHeader heading="Manifold" />
      </div>

      <SearchQueryBar
        query={query}
        onQueryChange={setQuery}
        matchTypeFilter={matchTypeFilter}
        onMatchTypeFilterChange={setMatchTypeFilter}
        isSearching={isSearching}
        tagDefs={tagsState.tags}
        tagFilterIds={tagFilterIds}
        onToggleTagFilter={toggleTagFilter}
        availableFileTypes={availableSearchFileTypes}
        fileTypeFilter={fileTypeFilter}
        onFileTypeFilterChange={setFileTypeFilter}
      />

      <div className="mt-5 min-h-0 flex-1">
        <ScrollArea className="h-full pr-3">
          {groupedResults.length === 0 ? (
            showingTagBrowse ? null : !hasSearched ? (
              liveIndexedCount === 0 && embeddingPhase !== "scanning" ? (
                <Empty className="min-h-[15rem] border-border/60 bg-muted/10 py-16">
                  <EmptyHeader>
                    <EmptyTitle>No files indexed yet</EmptyTitle>
                    <EmptyDescription>
                      Add one or more folders before running search.
                    </EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent className="pt-1">
                    <Button variant="link" className="h-auto p-0" asChild>
                      <Link to="/settings">Open Settings</Link>
                    </Button>
                  </EmptyContent>
                </Empty>
              ) : null
            ) : searchError ? (
              <AppAlert
                variant="banner"
                title="Search Error"
                className="mx-auto max-w-md"
                message={searchError}
              />
            ) : !hasMatchTypeEnabled ? (
              <div className="app-muted text-center">
                Enable at least one search type (OCR, Text, or Semantic).
              </div>
            ) : null
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {groupedResults.map((group) => {
                const r = group.primaryResult;
                const ext = r.file.path.split(".").pop()?.toLowerCase() ?? "";
                const isPreviewImage =
                  ext === "png" || ext === "jpg" || ext === "jpeg";
                const isPreviewFile = isPreviewImage || ext === "pdf";
                const isStacked = group.variants.length > 1;
                return (
                  <FileSearchResultCard
                    key={group.key}
                    path={r.file.path}
                    onMouseEnter={() => {
                      if (r.matchType !== "text" && r.matchType !== "ocr")
                        return;
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
                          const fullText = await textIndexFullTextForPath(
                            cfg.sourceId,
                            r.file.path,
                          );
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
                    onClick={async (e) => {
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
                      let pdfTextMatch: FileResultLocationState["pdfTextMatch"];
                      if (
                        (r.matchType === "text" || r.matchType === "ocr") &&
                        ext === "pdf" &&
                        query.trim()
                      ) {
                        const fullText =
                          fullTextCacheRef.current[r.file.path] ??
                          (await textIndexFullTextForPath(
                            cfg.sourceId,
                            r.file.path,
                          ).catch((error) => {
                            searchLog.warn("text-match:open:full-text failed", {
                              path: r.file.path,
                              error: String(error),
                            });
                            return undefined;
                          }));
                        if (fullText) {
                          fullTextCacheRef.current[r.file.path] = fullText;
                        }
                        if (
                          shouldOpenPdfTextPreview({
                            fullText,
                            path: r.file.path,
                            query: query.trim(),
                          })
                        ) {
                          pdfTextMatch = {
                            searchQuery: query.trim(),
                            matchKind: r.matchType,
                          };
                        }
                      }
                      navigate(
                        `/file?path=${encodeURIComponent(r.file.path)}`,
                        {
                          state: {
                            returnTo: "/",
                            ...(isStacked
                              ? {
                                  sameContentPaths: group.variants.map(
                                    (v) => v.file.path,
                                  ),
                                }
                              : {}),
                            ...(pdfTextMatch ? { pdfTextMatch } : {}),
                          } satisfies FileResultLocationState,
                        },
                      );
                    }}
                    thumbUrl={thumbByPath[r.file.path] ?? null}
                    thumbFailed={!!thumbFailedByPath[r.file.path]}
                    thumbExpectLoading={
                      isPreviewFile && !thumbFailedByPath[r.file.path]
                    }
                    hoverChip={
                      !showingTagBrowse &&
                      cfg.showSimilarityOnHover &&
                      r.matchType === "semantic"
                        ? `Similarity ${formatSimilarityScore(r.score)}`
                        : null
                    }
                    tagDots={tagsForPath(tagsState, r.file.path)}
                    matchType={showingTagBrowse ? undefined : r.matchType}
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
            onIgnoreEmbedFailure={ignoreEmbedFailure}
            onRetryEmbedding={retryEmbedding}
            indexedCount={liveIndexedCount}
          />
        </div>
      </div>
    </section>
  );
}
