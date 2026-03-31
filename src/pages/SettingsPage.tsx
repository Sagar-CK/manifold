import { ArrowLeft, FolderPlus, Loader, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { homeDir } from "@tauri-apps/api/path";
import { useEffect, useState } from "react";
import type { LocalConfig, SupportedExt } from "../lib/localConfig";
import { saveConfig } from "../lib/localConfig";
import { PageHeader } from "../components/PageHeader";
import { EmbeddingProgressBar } from "../components/EmbeddingProgressBar";
import { Button } from "../components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../components/ui/alert-dialog";
import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "../components/ui/combobox";
import { Toggle } from "../components/ui/toggle";

const SEARCH_MODE_OPTIONS = [
  { value: "topK", label: "Top-K" },
  { value: "scoreThreshold", label: "Semantic score" },
] as const;
type SearchModeOption = (typeof SEARCH_MODE_OPTIONS)[number];

export function SettingsPage({
  cfg,
  setCfg,
  embedding,
  hasPendingEmbeds,
  embedProgress,
  extOptions,
  needsEmbedding,
  embedPlan,
  embedPromptDismissed,
  embeddingPhase,
  lastEmbedError,
  onContinueEmbedding,
  onPauseEmbedding,
  onResumeEmbedding,
  onCancelEmbedding,
  onCancelEmbeddingPrompt,
}: {
  cfg: LocalConfig;
  setCfg: (next: LocalConfig) => void;
  embedding: boolean;
  hasPendingEmbeds: boolean;
  embedProgress: {
    processed: number;
    total: number;
    status: string;
  };
  extOptions: SupportedExt[];
  needsEmbedding: boolean;
  embedPlan: {
    totalSelected: number | null;
    pending: number | null;
    warning: string | null;
  };
  embedPromptDismissed: boolean;
  embeddingPhase:
    | "idle"
    | "scanning"
    | "embedding"
    | "paused"
    | "cancelling"
    | "done"
    | "error";
  lastEmbedError: string | null;
  onContinueEmbedding: () => Promise<void>;
  onPauseEmbedding: () => Promise<void>;
  onResumeEmbedding: () => Promise<void>;
  onCancelEmbedding: () => Promise<void>;
  onCancelEmbeddingPrompt: () => void;
}) {
  const [homePath, setHomePath] = useState("");
  const [clearingIndex, setClearingIndex] = useState(false);
  const [clearIndexError, setClearIndexError] = useState<string | null>(null);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [embeddedCount, setEmbeddedCount] = useState<number | null>(null);
  const [continueError, setContinueError] = useState<string | null>(null);
  const [jobControlError, setJobControlError] = useState<string | null>(null);
  const selectedSearchModeOption: SearchModeOption | null =
    SEARCH_MODE_OPTIONS.find((option) => option.value === cfg.searchMode) ?? null;

  function updateConfig(next: LocalConfig) {
    setCfg(next);
    saveConfig(next);
  }

  async function deleteAllVectors() {
    setClearIndexError(null);
    setClearingIndex(true);
    try {
      await invoke("qdrant_delete_all_points", { args: { sourceId: cfg.sourceId } });
      // Bump sourceId to force a clean re-index cycle + avoid any stale per-source caches.
      updateConfig({ ...cfg, sourceId: crypto.randomUUID() });
      setConfirmClearOpen(false);
    } catch (e) {
      setClearIndexError(String(e));
    } finally {
      setClearingIndex(false);
    }
  }

  async function pickFolder(label: string): Promise<string | null> {
    try {
      const selection = await openDialog({
        directory: true,
        multiple: false,
        title: label,
      });
      if (typeof selection === "string") return selection;
      return null;
    } catch {
      const dir = window.prompt(`${label} (absolute path)`);
      return dir && dir.trim().length > 0 ? dir.trim() : null;
    }
  }

  const hasEmbeddingIssue =
    embedProgress.status.startsWith("Embedding error:") ||
    embedProgress.status.startsWith("Missing ");

  function formatPathForDisplay(path: string) {
    const normalize = (value: string) => value.replace(/\\/g, "/").replace(/\/+$/, "");
    const normalizedPath = normalize(path.trim());
    const normalizedHome = normalize(homePath.trim());
    if (!normalizedHome) return normalizedPath;

    if (normalizedPath.toLowerCase() === normalizedHome.toLowerCase()) {
      return "~";
    }
    const homePrefix = `${normalizedHome}/`;
    if (normalizedPath.toLowerCase().startsWith(homePrefix.toLowerCase())) {
      return `~/${normalizedPath.slice(homePrefix.length)}`;
    }
    return normalizedPath;
  }

  useEffect(() => {
    let cancelled = false;

    async function loadHomePath() {
      try {
        const home = await homeDir();
        if (!cancelled) setHomePath(home);
      } catch {
        if (!cancelled) setHomePath("");
      }
    }

    void loadHomePath();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadEmbeddedCount() {
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

    void loadEmbeddedCount();
    return () => {
      cancelled = true;
    };
  }, [cfg.sourceId, clearingIndex]);

  return (
    <section>
      <div className="relative mb-8">
        <Link
          to="/"
          className="absolute left-0 top-0 inline-flex h-9 w-9 items-center justify-center rounded-md text-black/70 hover:bg-black/5 hover:text-black"
          aria-label="Back to search"
          title="Back"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        </Link>
        <PageHeader heading="Settings" />
      </div>

      <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
        <div className="p-2">
          <div className="app-section-title">Paths</div>

          <div className="mt-4">
            <div className="flex items-center justify-between gap-2">
              <div className="app-label">Include folders</div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Add include folder"
                title="Add include folder"
                onClick={async () => {
                  const dir = await pickFolder("Add include folder");
                  if (!dir) return;
                  if (cfg.include.includes(dir)) return;
                  updateConfig({ ...cfg, include: [...cfg.include, dir] });
                }}
              >
                <FolderPlus className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
            <div className="mt-2 flex flex-col gap-2">
              {cfg.include.length === 0 ? (
                <div className="app-muted">No include folders yet.</div>
              ) : (
                cfg.include.map((p) => (
                  <div key={p} className="flex items-center justify-between gap-2 text-sm">
                    <div className="min-w-0 flex-1 truncate rounded-md bg-black/5 px-2 py-1 font-mono text-[12px] text-black/70">
                      {formatPathForDisplay(p)}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove include folder ${formatPathForDisplay(p)}`}
                      title="Remove include folder"
                      onClick={() =>
                        updateConfig({ ...cfg, include: cfg.include.filter((x) => x !== p) })
                      }
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="mt-5">
            <div className="flex items-center justify-between gap-2">
              <div className="app-label">Exclude folders</div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Add exclude folder"
                title="Add exclude folder"
                onClick={async () => {
                  const dir = await pickFolder("Add exclude folder");
                  if (!dir) return;
                  if (cfg.exclude.includes(dir)) return;
                  updateConfig({ ...cfg, exclude: [...cfg.exclude, dir] });
                }}
              >
                <FolderPlus className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
            <div className="mt-2 flex flex-col gap-2">
              {cfg.exclude.length === 0 ? (
                <div className="app-muted">No exclude folders.</div>
              ) : (
                cfg.exclude.map((p) => (
                  <div key={p} className="flex items-center justify-between gap-2 text-sm">
                    <div className="min-w-0 flex-1 truncate rounded-md bg-black/5 px-2 py-1 font-mono text-[12px] text-black/70">
                      {formatPathForDisplay(p)}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove exclude folder ${formatPathForDisplay(p)}`}
                      title="Remove exclude folder"
                      onClick={() =>
                        updateConfig({ ...cfg, exclude: cfg.exclude.filter((x) => x !== p) })
                      }
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="p-2">
          <div className="app-section-title">Embedding & Search</div>

          <div className="mt-4">
            <div className="app-label">File types</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {extOptions.map((ext) => (
                <Toggle
                  key={ext}
                  pressed={cfg.extensions.includes(ext)}
                  onPressedChange={(pressed) => {
                    if (pressed === undefined) return;
                    const next = pressed
                      ? Array.from(new Set([...cfg.extensions, ext]))
                      : cfg.extensions.filter((x) => x !== ext);
                    updateConfig({ ...cfg, extensions: next });
                  }}
                  variant="outline"
                  className="h-auto min-w-0 px-3 py-1.5 text-center font-medium tracking-tight transition-all duration-200 ease-out data-[state=on]:scale-[1.02] data-[state=on]:border-emerald-200 data-[state=on]:bg-emerald-100 data-[state=on]:text-emerald-900 data-[state=on]:shadow-sm data-[state=off]:scale-100 data-[state=off]:border-zinc-200 data-[state=off]:bg-zinc-100 data-[state=off]:text-zinc-500"
                >
                  {ext}
                </Toggle>
              ))}
            </div>
          </div>

          <div className="mt-5">
            <div className="flex items-center justify-between gap-3">
                <div className="app-body font-medium">Similarity threshold</div>
              <Combobox<SearchModeOption>
                value={selectedSearchModeOption}
                onValueChange={(value) => {
                  if (!value) return;
                  updateConfig({
                    ...cfg,
                    searchMode: value.value,
                  });
                }}
              >
                <ComboboxInput
                  readOnly
                  showClear={false}
                  aria-label="Similarity mode"
                  className="w-44"
                />
                <ComboboxContent>
                  <ComboboxList>
                    {SEARCH_MODE_OPTIONS.map((option) => (
                      <ComboboxItem key={option.value} value={option}>
                        {option.label}
                      </ComboboxItem>
                    ))}
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
            </div>

            {cfg.searchMode === "topK" ? (
              <div className="mt-3 flex items-center gap-3">
                <div className="app-muted">Results to return</div>
                <input
                  type="number"
                  min={1}
                  max={256}
                  step={1}
                  value={cfg.topK}
                  onChange={(e) => {
                    const next = Number.parseInt(e.target.value, 10);
                    if (Number.isNaN(next)) return;
                    updateConfig({ ...cfg, topK: Math.max(1, Math.min(256, next)) });
                  }}
                  className="w-24 rounded-md border border-black/15 bg-white px-2 py-1 text-sm"
                />
              </div>
            ) : (
              <div className="mt-3">
                <div className="app-muted mb-2 flex items-center justify-between">
                  <span>Minimum semantic score</span>
                  <span>{Math.round(cfg.scoreThreshold * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={Math.round(cfg.scoreThreshold * 100)}
                  onChange={(e) => {
                    const next = Number.parseInt(e.target.value, 10);
                    if (Number.isNaN(next)) return;
                    updateConfig({ ...cfg, scoreThreshold: Math.max(0, Math.min(1, next / 100)) });
                  }}
                  className="w-full"
                />
              </div>
            )}
          </div>

        </div>
      </div>

      <div className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="app-section-title text-black">Delete all vectors</div>
            <div className="app-muted mt-0.5 max-w-lg">
              Clears the local Qdrant index (embeddings only). Your files will not be deleted from disk. Currently, {embeddedCount} file(s) are indexed.
            </div>
            {clearIndexError ? (
              <div className="mt-2 text-sm font-medium text-rose-700">Error: {clearIndexError}</div>
            ) : null}
          </div>

          <AlertDialog open={confirmClearOpen} onOpenChange={setConfirmClearOpen}>
            <AlertDialogTrigger asChild>
              <Button
                variant="destructive"
                disabled={clearingIndex || embedding || hasPendingEmbeds || embeddedCount === 0}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                {clearingIndex && <Loader className="h-4 w-4 animate-spin" aria-hidden="true" /> }
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle className="text-black">Delete all {embeddedCount} vectors?</AlertDialogTitle>
                <AlertDialogDescription>
                  Clears all indexed vectors for this profile. Files are not deleted.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={clearingIndex}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  disabled={clearingIndex}
                  onClick={async (e) => {
                    e.preventDefault();
                    await deleteAllVectors();
                  }}
                >
                  Delete vectors
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
      <div className="mt-8 flex min-h-24 items-center justify-center">
        {embedding || hasPendingEmbeds ? (
          <div className="w-full max-w-sm">
            <EmbeddingProgressBar
              embedding={embedding}
              hasPendingEmbeds={hasPendingEmbeds}
              embeddingPhase={embeddingPhase}
              processed={embedProgress.processed}
              total={embedProgress.total}
              showControls
              controlsDisabled={clearingIndex}
              onPause={async () => {
                setJobControlError(null);
                try {
                  await onPauseEmbedding();
                } catch (e) {
                  setJobControlError(String(e));
                }
              }}
              onResume={async () => {
                setJobControlError(null);
                try {
                  await onResumeEmbedding();
                } catch (e) {
                  setJobControlError(String(e));
                }
              }}
              onCancel={async () => {
                setJobControlError(null);
                try {
                  await onCancelEmbedding();
                } catch (e) {
                  setJobControlError(String(e));
                }
              }}
            />
            {lastEmbedError ? (
              <div className="mt-2 text-center text-xs font-medium text-rose-700">
                {lastEmbedError}
              </div>
            ) : null}
            {jobControlError ? (
              <div className="mt-2 text-center text-xs font-medium text-rose-700">
                {jobControlError}
              </div>
            ) : null}
          </div>
        ) : needsEmbedding ? (
          <div className="w-full max-w-xl rounded-lg border border-black/10 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="app-section-title">Embedding paused</div>
                <div className="app-muted mt-1">
                  Your selections changed. Click Continue when you're ready to (re)embed files.
                </div>
                {typeof embedPlan.totalSelected === "number" ? (
                  <div className="app-muted mt-2 tabular-nums">
                    Planned:{" "}
                    <span className="font-medium text-black/80">
                      {embedPlan.pending ?? embedPlan.totalSelected}
                    </span>{" "}
                    file(s) to embed
                    {embedPlan.pending === null ? (
                      <span className="text-black/50"> (estimate)</span>
                    ) : (
                      <span className="text-black/50"> (exact)</span>
                    )}
                  </div>
                ) : null}
                {embedPlan.warning ? (
                  <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    <div className="font-semibold">Warning</div>
                    <div className="mt-1 text-amber-900/90">{embedPlan.warning}</div>
                  </div>
                ) : null}
                {continueError ? (
                  <div className="mt-2 text-sm font-medium text-rose-700">Error: {continueError}</div>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-col gap-2">
                <Button
                  disabled={embedding || clearingIndex}
                  onClick={async () => {
                    setContinueError(null);
                    try {
                      await onContinueEmbedding();
                    } catch (e) {
                      setContinueError(String(e));
                    }
                  }}
                >
                  Continue
                </Button>
                <Button
                  variant="ghost"
                  disabled={embedding || clearingIndex}
                  onClick={() => {
                    setContinueError(null);
                    onCancelEmbeddingPrompt();
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        ) : embedPromptDismissed ? (
          <div className="app-muted font-medium">{embedProgress.status}</div>
        ) : hasEmbeddingIssue ? (
          <div className="app-body font-medium text-rose-700">{embedProgress.status}</div>
        ) : (
          <div />
        )}
      </div>
    </section>
  );
}

