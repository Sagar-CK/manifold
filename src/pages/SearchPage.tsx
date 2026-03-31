import { useAction } from "convex/react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import { Settings } from "lucide-react";
import { api } from "../../convex/_generated/api";
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

export function SearchPage({ cfg }: { cfg: LocalConfig }) {
  const geminiApiKey =
    (import.meta.env.VITE_GOOGLE_GENERATIVE_AI_API_KEY as string | undefined) ?? "";

  const semanticSearch = useAction(api.search.semantic);

  const [query, setQuery] = useState("");
  const [hasSearched, setHasSearched] = useState(false);
  const [results, setResults] = useState<
    Array<{
      score: number;
      file: {
        _id: string;
        path: string;
        mimeType: string;
        ext: string;
        mtimeMs: number;
        sizeBytes: number;
      };
    }>
  >([]);
  const [thumbByPath, setThumbByPath] = useState<Record<string, string>>({});
  async function runSearch(queryText: string) {
    setHasSearched(true);
    setResults([]);
    setThumbByPath({});
    if (!geminiApiKey) return;

    const queryVector = await cachedEmbedding(`q:${OUTPUT_DIM}:${queryText}`, async () => {
      return await embedText(geminiApiKey, queryText);
    });

    const res = await semanticSearch({
      sourceId: cfg.sourceId,
      queryVector,
      limit: 24,
    });
    const filtered = (res as typeof results).filter((r) => r.score >= cfg.scoreThreshold);

    setResults(filtered);

    for (const r of filtered) {
      const p = r.file.path;
      const ext = r.file.ext.toLowerCase();
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
  }, [query, cfg.sourceId, cfg.scoreThreshold]);

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
            <Link
              to="/settings"
              className="mx-auto block w-fit text-sm text-black/60 underline underline-offset-4 hover:text-black"
            >
              No files embedded yet.
            </Link>
          ) : null
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {results.map((r) => (
              <button
                key={r.file._id}
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
                        {fileTypeLabel(r.file.ext, r.file.mimeType)}
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
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
