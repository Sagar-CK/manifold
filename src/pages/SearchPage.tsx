import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import { Settings } from "lucide-react";
import { Input } from "../components/ui/input";
import { cachedEmbedding, embedText, OUTPUT_DIM } from "../lib/geminiEmbeddings";
import type { LocalConfig } from "../lib/localConfig";
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
  const extSelected = cfg.extensions.includes(ext as never);

  return inInclude && !inExclude && extSelected;
}

export function SearchPage({ cfg }: { cfg: LocalConfig }) {
  const geminiApiKey =
    (import.meta.env.VITE_GOOGLE_GENERATIVE_AI_API_KEY as string | undefined) ?? "";

  const [query, setQuery] = useState("");
  const [hasSearched, setHasSearched] = useState(false);
  const [embeddedCount, setEmbeddedCount] = useState<number | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [results, setResults] = useState<
    Array<{
      score: number;
      file: {
        path: string;
      };
    }>
  >([]);
  const [thumbByPath, setThumbByPath] = useState<Record<string, string>>({});

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

  async function runSearch(queryText: string) {
    setHasSearched(true);
    setResults([]);
    setThumbByPath({});
    setSearchError(null);
    if (!geminiApiKey) return;

    const queryVector = await cachedEmbedding(`q:${OUTPUT_DIM}:${queryText}`, async () => {
      return await embedText(geminiApiKey, queryText);
    });

    const searchLimit = cfg.searchMode === "topK" ? cfg.topK : 256;
    let res: typeof results;
    try {
      res = (await invoke("qdrant_semantic_search", {
        args: {
          sourceId: cfg.sourceId,
          queryVector,
          limit: searchLimit,
        },
      })) as typeof results;
    } catch (e) {
      setSearchError(String(e));
      setResults([]);
      return;
    }
    const filtered =
      cfg.searchMode === "scoreThreshold"
        ? (res as typeof results).filter((r) => r.score >= cfg.scoreThreshold)
        : (res as typeof results).slice(0, cfg.topK);

    // Automatically ignore hits that are outside current selected folders/extensions.
    const selectedOnly = filtered.filter((r) => isPathSelected(r.file.path, cfg));
    setResults(selectedOnly);

    for (const r of selectedOnly) {
      const p = r.file.path;
      const ext = p.split(".").pop()?.toLowerCase() ?? "";
      if (ext === "png" || ext === "jpg" || ext === "jpeg") {
        try {
          const thumb = (await invoke("thumbnail_image_base64_png", {
            args: { path: p, max_edge: 96 },
          })) as { png_base64: string };
          setThumbByPath((m) => ({ ...m, [p]: `data:image/png;base64,${thumb.png_base64}` }));
        } catch {
          // ignore thumb errors
        }
      }
    }
  }

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setHasSearched(false);
      setResults([]);
      setThumbByPath({});
      return;
    }

    const timer = window.setTimeout(() => {
      void runSearch(trimmed);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, cfg.sourceId, cfg.searchMode, cfg.scoreThreshold, cfg.topK]);

  return (
    <section>
      <div className="relative flex flex-col items-center justify-center text-center gap-2 mb-6">
        <Link
          to="/settings"
          className="absolute right-0 top-0 inline-flex h-9 w-9 items-center justify-center rounded-md text-black/70 hover:bg-black/5 hover:text-black"
          aria-label="Open settings"
          title="Settings"
        >
          <Settings className="h-5 w-5" aria-hidden="true" />
        </Link>

        <PageHeader heading="manifold" subtitle="native semantic file search" />
      </div>

      <div className="flex">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search across your files…"
          className="flex-1"
        />
      </div>

      <div className="mt-5">
        {results.length === 0 ? (
          !hasSearched ? (
            embeddedCount === 0 ? (
              <Link
                to="/settings"
                className="mx-auto block w-fit text-sm text-black/60 underline underline-offset-4 hover:text-black"
              >
                No files embedded yet. Open Settings to add folders.
              </Link>
            ) : (
              <div className="text-center text-sm text-black/60">
                Type to search{typeof embeddedCount === "number" ? ` (${embeddedCount} file(s) indexed)` : ""}.
              </div>
            )
          ) : searchError ? (
            <div className="text-center text-sm font-medium text-rose-700">
              Search error: {searchError}
            </div>
          ) : (
            <div className="text-center text-sm text-black/60">No results for “{query.trim()}”.</div>
          )
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {results.map((r) => (
              (() => {
                const ext = r.file.path.split(".").pop()?.toLowerCase() ?? "";
                return (
              <button
                key={r.file.path}
                type="button"
                onClick={() => openPath(r.file.path)}
                className="flex flex-col items-center gap-2 min-w-0 rounded-lg p-1 hover:bg-black/[0.04] transition-colors"
                title={r.file.path}
              >
                <div className="h-24 w-full rounded-md bg-black/5 overflow-hidden flex items-center justify-center">
                  {thumbByPath[r.file.path] ? (
                    <img src={thumbByPath[r.file.path]} className="h-full w-full object-contain" />
                  ) : (
                    <div className="h-11 w-11 rounded-md border border-black/10 bg-black/[0.04] flex items-center justify-center">
                      <span className="text-[10px] leading-none font-semibold text-black/60 uppercase tracking-wide">
                        {fileTypeLabel(ext, "")}
                      </span>
                    </div>
                  )}
                </div>
                <div className="min-w-0 w-full">
                  <div className="text-xs font-medium text-center truncate">
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
    </section>
  );
}
