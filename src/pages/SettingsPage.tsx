import { ArrowLeft, Check, FolderPlus, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { homeDir } from "@tauri-apps/api/path";
import { useEffect, useState } from "react";
import type { LocalConfig, SupportedExt } from "../lib/localConfig";
import { saveConfig } from "../lib/localConfig";
import { PageHeader } from "../components/PageHeader";
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
import { Progress } from "../components/ui/progress";

function Checkbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="group flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-black/5">
      <input
        type="checkbox"
        className="h-4 w-4 accent-black"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="font-medium tracking-tight">{label}</span>
    </label>
  );
}

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
  onContinueEmbedding,
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
  onContinueEmbedding: () => Promise<void>;
  onCancelEmbeddingPrompt: () => void;
}) {
  const [homePath, setHomePath] = useState("");
  const [clearingIndex, setClearingIndex] = useState(false);
  const [clearIndexError, setClearIndexError] = useState<string | null>(null);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [continueError, setContinueError] = useState<string | null>(null);
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

  const progressValue =
    embedProgress.total > 0 ? (embedProgress.processed / embedProgress.total) * 100 : 0;
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
        <PageHeader heading="Settings" subtitle="Embedding + search" />
      </div>

      <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
        <div className="p-2">
          <div className="font-semibold tracking-tight">Paths</div>

          <div className="mt-4">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-medium uppercase tracking-wide text-black/50">Include folders</div>
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
                <div className="text-sm text-black/50">No include folders yet.</div>
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
              <div className="text-xs font-medium uppercase tracking-wide text-black/50">Exclude folders</div>
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
                <div className="text-sm text-black/50">No exclude folders.</div>
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
          <div className="font-semibold tracking-tight">Embedding & Search</div>

          <div className="mt-4">
            <div className="text-xs font-medium uppercase tracking-wide text-black/50">
              File types
            </div>
            <div className="mt-2 grid grid-cols-2 gap-1">
              {extOptions.map((ext) => (
                <Checkbox
                  key={ext}
                  label={ext}
                  checked={cfg.extensions.includes(ext)}
                  onChange={(checked) => {
                    const next = checked
                      ? Array.from(new Set([...cfg.extensions, ext]))
                      : cfg.extensions.filter((x) => x !== ext);
                    updateConfig({ ...cfg, extensions: next });
                  }}
                />
              ))}
            </div>
          </div>

          <div className="mt-5">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-medium">Similarity threshold</div>
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
                <div className="text-xs text-black/60">Results to return</div>
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
                <div className="mb-2 flex items-center justify-between text-xs text-black/60">
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
            <div className="text-sm font-semibold tracking-tight text-rose-700">Delete all vectors</div>
            <div className="mt-0.5 text-sm text-black/60">
              Clears the local Qdrant index for this profile (embeddings only). Your files stay on disk.
            </div>
            {clearIndexError ? (
              <div className="mt-2 text-sm font-medium text-rose-700">Error: {clearIndexError}</div>
            ) : null}
          </div>

          <AlertDialog open={confirmClearOpen} onOpenChange={setConfirmClearOpen}>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" disabled={clearingIndex || embedding || hasPendingEmbeds}>
                <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
                {clearingIndex ? "Deleting…" : "Delete all vectors"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete all vectors?</AlertDialogTitle>
                <AlertDialogDescription>
                  This removes embeddings from your local Qdrant index{typeof embedPlan.totalSelected === "number"
                    ? ` (up to ${embedPlan.totalSelected} selected file(s)).`
                    : "."}{" "}
                  Your files won’t be deleted, but search will return no results until you re-embed.
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
            {embedProgress.total > 0 ? (
              <div className="mt-1 text-center text-xs tabular-nums text-black/60">
                {embedProgress.processed}/{embedProgress.total}
              </div>
            ) : null}
            <Progress className="mt-2" value={progressValue} />
            <div className="mt-2 text-center text-sm font-medium tracking-tight">
              {embedProgress.status}
            </div>
          </div>
        ) : needsEmbedding ? (
          <div className="w-full max-w-xl rounded-lg border border-black/10 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold tracking-tight">Embedding paused</div>
                <div className="mt-1 text-sm text-black/60">
                  Your selections changed. Click Continue when you're ready to (re)embed files.
                </div>
                {typeof embedPlan.totalSelected === "number" ? (
                  <div className="mt-2 text-sm text-black/60 tabular-nums">
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
          <div className="text-sm font-medium text-black/60">{embedProgress.status}</div>
        ) : hasEmbeddingIssue ? (
          <div className="text-sm font-medium text-rose-700">{embedProgress.status}</div>
        ) : (
          <div className="flex items-center gap-2 text-sm font-medium text-black/70">
            <Check className="h-4 w-4" aria-hidden="true" />
            <span>All files embedded.</span>
          </div>
        )}
      </div>
    </section>
  );
}

