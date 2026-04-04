import { ArrowLeft, FolderPlus, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { homeDir } from "@tauri-apps/api/path";
import { useEffect, useState } from "react";
import { collapseIncludeFolders, type LocalConfig, type SupportedExt } from "../lib/localConfig";
import { saveConfig } from "../lib/localConfig";
import { PageHeader } from "../components/PageHeader";
import { EmbeddingStatusPanel } from "../components/EmbeddingStatusPanel";
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
import { Slider } from "../components/ui/slider";
import { Switch } from "../components/ui/switch";
import { Spinner } from "../components/ui/spinner";
import { Toggle } from "../components/ui/toggle";

const SEARCH_MODE_OPTIONS = [
  { value: "topK", label: "Top-K" },
  { value: "scoreThreshold", label: "Semantic score" },
] as const;
type SearchModeOption = (typeof SEARCH_MODE_OPTIONS)[number];

type IncludeFolderBreakdown = {
  total: number;
  textLike: number;
  image: number;
  audio: number;
  video: number;
};

function parseScanCount(value: number | string): number {
  const n = typeof value === "string" ? Number.parseInt(value, 10) : value;
  return Number.isFinite(n) ? n : 0;
}

export function SettingsPage({
  cfg,
  setCfg,
  embedding,
  hasPendingEmbeds,
  embedProgress,
  extOptions,
  embeddingPhase,
  lastEmbedError,
  embedFailures,
  onCancelEmbedding,
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
  embeddingPhase:
    | "idle"
    | "scanning"
    | "embedding"
    | "paused"
    | "cancelling"
    | "done"
    | "error";
  lastEmbedError: string | null;
  embedFailures: Array<{ path: string; reason: string }>;
  onCancelEmbedding: () => Promise<void>;
}) {
  const [homePath, setHomePath] = useState("");
  const [clearingIndex, setClearingIndex] = useState(false);
  const [clearIndexError, setClearIndexError] = useState<string | null>(null);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [embeddedCount, setEmbeddedCount] = useState<number | null>(null);
  const [includeToRemove, setIncludeToRemove] = useState<string | null>(null);
  const [confirmRemoveIncludeOpen, setConfirmRemoveIncludeOpen] = useState(false);
  const [removeIncludeLoading, setRemoveIncludeLoading] = useState(false);
  const [removeIncludeError, setRemoveIncludeError] = useState<string | null>(null);
  const [confirmAddIncludeOpen, setConfirmAddIncludeOpen] = useState(false);
  const [addIncludeLoading, setAddIncludeLoading] = useState(false);
  const [addIncludeError, setAddIncludeError] = useState<string | null>(null);
  const [includeToAdd, setIncludeToAdd] = useState<string | null>(null);
  const [includeAddBreakdown, setIncludeAddBreakdown] = useState<IncludeFolderBreakdown | null>(
    null,
  );
  const [confirmDisableDefaultExcludesOpen, setConfirmDisableDefaultExcludesOpen] =
    useState(false);
  const liveIndexedCount =
    embedding || hasPendingEmbeds
      ? Math.max(embeddedCount ?? 0, embedProgress.processed)
      : embeddedCount;
  const selectedSearchModeOption: SearchModeOption | null =
    SEARCH_MODE_OPTIONS.find((option) => option.value === cfg.searchMode) ?? null;

  function updateConfig(next: LocalConfig) {
    setCfg(next);
    saveConfig(next);
  }

  async function refreshEmbeddedCount(sourceId: string) {
    try {
      const res = (await invoke("qdrant_count_points", {
        args: { sourceId },
      })) as { count: number } | { count: string };
      const count = typeof res.count === "string" ? Number.parseInt(res.count, 10) : res.count;
      setEmbeddedCount(Number.isFinite(count) ? count : 0);
    } catch {
      setEmbeddedCount(null);
    }
  }

  async function deleteAllVectors() {
    setClearIndexError(null);
    setClearingIndex(true);
    try {
      try {
        if (embedding || hasPendingEmbeds) {
          await onCancelEmbedding();
        }
      } catch {
        // Job may have finished between render and invoke; still clear Qdrant.
      }
      await invoke("qdrant_delete_all_points", { args: { sourceId: cfg.sourceId } });
      // Bump sourceId to force a clean re-index cycle + avoid any stale per-source caches.
      const nextSourceId = crypto.randomUUID();
      updateConfig({ ...cfg, sourceId: nextSourceId, include: [] });
      await refreshEmbeddedCount(nextSourceId);
      setConfirmClearOpen(false);
    } catch (e) {
      setClearIndexError(String(e));
    } finally {
      setClearingIndex(false);
    }
  }

  function prepareRemoveIncludeFolder(path: string) {
    setIncludeToRemove(path);
    setRemoveIncludeError(null);
    setConfirmRemoveIncludeOpen(true);
  }

  async function removeIncludeFolderAndVectors() {
    if (!includeToRemove) return;
    setRemoveIncludeError(null);
    setRemoveIncludeLoading(true);
    try {
      try {
        if (embedding || hasPendingEmbeds) {
          await onCancelEmbedding();
        }
      } catch {
        // Job may have finished between render and invoke.
      }
      await invoke("qdrant_delete_points_for_include_path", {
        args: {
          sourceId: cfg.sourceId,
          includePath: includeToRemove,
        },
      });
      const nextInclude = cfg.include.filter((x) => x !== includeToRemove);
      updateConfig({ ...cfg, include: nextInclude });
      if (nextInclude.length === 0 && (embedding || hasPendingEmbeds)) {
        try {
          await onCancelEmbedding();
        } catch {
          // ignore
        }
      }
      await refreshEmbeddedCount(cfg.sourceId);
      setConfirmRemoveIncludeOpen(false);
      setIncludeToRemove(null);
    } catch (e) {
      setRemoveIncludeError(String(e));
    } finally {
      setRemoveIncludeLoading(false);
    }
  }

  async function prepareAddIncludeFolder(path: string) {
    setIncludeToAdd(path);
    setAddIncludeError(null);
    setIncludeAddBreakdown(null);
    setConfirmAddIncludeOpen(true);
    setAddIncludeLoading(true);
    try {
      const res = (await invoke("scan_files_estimate", {
        args: {
          include: [path],
          exclude: cfg.exclude,
          extensions: cfg.extensions,
          useDefaultFolderExcludes: cfg.useDefaultFolderExcludes,
        },
      })) as {
        total: number | string;
        imageFiles: number | string;
        audioFiles: number | string;
        videoFiles: number | string;
        textLikeFiles: number | string;
      };
      setIncludeAddBreakdown({
        total: parseScanCount(res.total),
        textLike: parseScanCount(res.textLikeFiles),
        image: parseScanCount(res.imageFiles),
        audio: parseScanCount(res.audioFiles),
        video: parseScanCount(res.videoFiles),
      });
    } catch (e) {
      setAddIncludeError(String(e));
    } finally {
      setAddIncludeLoading(false);
    }
  }

  function confirmAddIncludeFolder() {
    if (!includeToAdd) return;
    updateConfig({ ...cfg, include: collapseIncludeFolders([...cfg.include, includeToAdd]) });
    setConfirmAddIncludeOpen(false);
    setAddIncludeError(null);
    setIncludeToAdd(null);
    setIncludeAddBreakdown(null);
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
    async function loadEmbeddedCount() {
      await refreshEmbeddedCount(cfg.sourceId);
    }

    void loadEmbeddedCount();
  }, [cfg.sourceId, clearingIndex]);

  return (
    <section className="flex min-h-[calc(100dvh-4rem)] flex-col">
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
                  const nextIncludes = collapseIncludeFolders([...cfg.include, dir]);
                  if (nextIncludes.length === cfg.include.length) return;
                  await prepareAddIncludeFolder(dir);
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
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      aria-label={`Remove include folder ${formatPathForDisplay(p)}`}
                      title="Remove include folder"
                      onClick={() => {
                        prepareRemoveIncludeFolder(p);
                      }}
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
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
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

          <div className="mt-5 flex items-start justify-between gap-3">
            <div>
              <div className="app-label">Skip common dependency and build folders</div>
              <div className="app-muted mt-1 max-w-xl">
                Skips folders such as <span className="font-mono">node_modules</span>,{" "}
                <span className="font-mono">.git</span>, and <span className="font-mono">dist</span>{" "}
                so indexing stays focused on your own files. Turning this off can add a very large
                number of files and increase API cost.
              </div>
            </div>
            <Switch
              checked={cfg.useDefaultFolderExcludes}
              onCheckedChange={(checked) => {
                if (checked) {
                  updateConfig({ ...cfg, useDefaultFolderExcludes: true });
                } else {
                  setConfirmDisableDefaultExcludesOpen(true);
                }
              }}
              aria-label="Skip common dependency and build folders"
              className="shrink-0"
            />
          </div>
        </div>

        <div className="p-2">
          <div className="app-section-title">Indexing & Search</div>

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
              <div className="app-label">Similarity threshold</div>
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
                <Slider
                  min={0}
                  max={100}
                  step={1}
                  value={[Math.round(cfg.scoreThreshold * 100)]}
                  onValueChange={(value) => {
                    const next = value?.[0];
                    if (typeof next !== "number" || Number.isNaN(next)) return;
                    updateConfig({ ...cfg, scoreThreshold: Math.max(0, Math.min(1, next / 100)) });
                  }}
                  className="w-full"
                />
              </div>
            )}
          </div>

          <div className="mt-5 flex items-center justify-between gap-3">
            <div>
              <div className="app-label">Show similarity on hover</div>
              <div className="app-muted mt-1">
                Shows the match badge when hovering a search result card.
              </div>
            </div>
            <Switch
              checked={cfg.showSimilarityOnHover}
              onCheckedChange={(checked) => {
                updateConfig({ ...cfg, showSimilarityOnHover: checked });
              }}
              aria-label="Toggle similarity badge on hover"
            />
          </div>

        </div>
      </div>

      <div className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="app-section-title text-black">Delete all vectors</div>
            <div className="app-muted mt-0.5 max-w-lg">
              Clears the local Qdrant index (vectors only). Your files will not be deleted from disk. Currently, {liveIndexedCount} file(s) are indexed.
            </div>
            {clearIndexError ? (
              <div className="mt-2 text-sm font-medium text-rose-700">Error: {clearIndexError}</div>
            ) : null}
          </div>

          <AlertDialog open={confirmClearOpen} onOpenChange={setConfirmClearOpen}>
            <AlertDialogTrigger asChild>
              <Button
                variant="destructive"
                disabled={clearingIndex || liveIndexedCount === 0}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                {clearingIndex && <Spinner className="h-4 w-4" aria-hidden="true" /> }
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle className="text-black">Delete all {liveIndexedCount} vectors?</AlertDialogTitle>
                <AlertDialogDescription>
                  Clears all indexed vectors for this profile. Files are not deleted.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel
                  disabled={clearingIndex}
                  className="h-auto min-h-9 px-3 py-2"
                  aria-label="Cancel deletion"
                  title="Cancel"
                >
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  disabled={clearingIndex}
                  className="h-auto min-h-9 px-3 py-2"
                  aria-label="Delete vectors"
                  title="Delete vectors"
                  onClick={async (e) => {
                    e.preventDefault();
                    await deleteAllVectors();
                  }}
                >
                  {clearingIndex ? (
                    <>
                      <Spinner className="h-4 w-4" aria-hidden="true" />
                      Deleting...
                    </>
                  ) : (
                    "Delete"
                  )}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <AlertDialog
        open={confirmAddIncludeOpen}
        onOpenChange={(open) => {
          setConfirmAddIncludeOpen(open);
          if (!open && !addIncludeLoading) {
            setIncludeToAdd(null);
            setIncludeAddBreakdown(null);
            setAddIncludeError(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-black">Add folder</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-black/70">
                <p className="tabular-nums">
                  {addIncludeLoading
                    ? "Counting files…"
                    : includeAddBreakdown !== null
                      ? `${includeAddBreakdown.total.toLocaleString()} file${includeAddBreakdown.total === 1 ? "" : "s"}`
                      : "—"}
                </p>
                {!addIncludeLoading && includeAddBreakdown !== null && includeAddBreakdown.total > 0 ? (
                  <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 text-sm tabular-nums">
                    {includeAddBreakdown.textLike > 0 ? (
                      <>
                        <span>Text / PDF</span>
                        <span className="text-right">{includeAddBreakdown.textLike.toLocaleString()}</span>
                      </>
                    ) : null}
                    {includeAddBreakdown.image > 0 ? (
                      <>
                        <span>Images</span>
                        <span className="text-right">{includeAddBreakdown.image.toLocaleString()}</span>
                      </>
                    ) : null}
                    {includeAddBreakdown.audio > 0 ? (
                      <>
                        <span>Audio</span>
                        <span className="text-right">{includeAddBreakdown.audio.toLocaleString()}</span>
                      </>
                    ) : null}
                    {includeAddBreakdown.video > 0 ? (
                      <>
                        <span>Video</span>
                        <span className="text-right">{includeAddBreakdown.video.toLocaleString()}</span>
                      </>
                    ) : null}
                  </div>
                ) : null}
                <p className="text-sm text-amber-900/80">
                  Bigger folders take longer and tend to use more provider quota.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          {addIncludeError ? (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              Error: {addIncludeError}
            </div>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={addIncludeLoading}
              className="h-auto min-h-9 px-3 py-2"
              aria-label="Cancel adding include folder"
              title="Cancel"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={addIncludeLoading || includeToAdd === null}
              className="h-auto min-h-9 px-3 py-2"
              aria-label="Confirm add include folder"
              title="Confirm add include folder"
              onClick={(e) => {
                e.preventDefault();
                confirmAddIncludeFolder();
              }}
            >
              {addIncludeLoading ? (
                <>
                  <Spinner className="h-4 w-4" aria-hidden="true" />
                  Confirming...
                </>
              ) : (
                "Confirm"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={confirmRemoveIncludeOpen}
        onOpenChange={(open) => {
          setConfirmRemoveIncludeOpen(open);
          if (!open && !removeIncludeLoading) {
            setIncludeToRemove(null);
            setRemoveIncludeError(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-black">
              Remove this include folder and its vectors?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This removes the folder from your include paths and deletes indexed vectors for files in
              that folder. Your files on disk are not deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {removeIncludeError ? (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              Error: {removeIncludeError}
            </div>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={removeIncludeLoading}
              className="h-auto min-h-9 px-3 py-2"
              aria-label="Cancel removal"
              title="Cancel"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={removeIncludeLoading || includeToRemove === null}
              className="h-auto min-h-9 px-3 py-2"
              aria-label="Remove folder and vectors"
              title="Remove folder and vectors"
              onClick={async (e) => {
                e.preventDefault();
                await removeIncludeFolderAndVectors();
              }}
            >
              {removeIncludeLoading ? (
                <>
                  <Spinner className="h-4 w-4" aria-hidden="true" />
                  Deleting...
                </>
              ) : (
                "Delete"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={confirmDisableDefaultExcludesOpen}
        onOpenChange={setConfirmDisableDefaultExcludesOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-black">
              Turn off automatic folder skipping?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Scanning and embedding may include many more files from dependencies, build outputs, and
              caches. Indexing will be slower and API usage costs can increase significantly.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-auto min-h-9 px-3 py-2">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="h-auto min-h-9 px-3 py-2"
              onClick={() => {
                updateConfig({ ...cfg, useDefaultFolderExcludes: false });
              }}
            >
              Turn off skipping
            </AlertDialogAction>
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
          />
        </div>
      </div>
    </section>
  );
}

