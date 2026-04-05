import { ArrowLeft, FolderPlus, Plus, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { homeDir } from "@tauri-apps/api/path";
import { useEffect, useState } from "react";
import { navigateBackOrFallback } from "../lib/navigateBack";
import { formatPathForDisplay } from "../lib/pathDisplay";
import { collapseIncludeFolders, type LocalConfig, type SupportedExt } from "../lib/localConfig";
import { saveConfig } from "../lib/localConfig";
import { syncPathTagsToQdrant } from "../lib/qdrantTags";
import {
  createTagDef,
  loadTagsState,
  removeTagEverywhere,
  saveTagsState,
  tagIdsForPath,
  type TagsState,
} from "../lib/tags";
import { PageHeader } from "../components/PageHeader";
import { EmbeddingStatusPanel } from "../components/EmbeddingStatusPanel";
import { TagDefBadge } from "../components/TagDefBadge";
import { Button } from "../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Separator } from "../components/ui/separator";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip";

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
  const navigate = useNavigate();
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
  const [tagsState, setTagsState] = useState<TagsState>(() => loadTagsState());
  const [tagNameDraft, setTagNameDraft] = useState("");
  const [tagColorDraft, setTagColorDraft] = useState("#6366f1");
  const [topKDraft, setTopKDraft] = useState(() => String(cfg.topK));
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

  function updateTags(next: TagsState) {
    saveTagsState(next);
    setTagsState(next);
  }

  function addTagFromDraft() {
    if (!tagNameDraft.trim()) return;
    const t = createTagDef(tagNameDraft, tagColorDraft);
    updateTags({ ...tagsState, tags: [...tagsState.tags, t] });
    setTagNameDraft("");
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

  useEffect(() => {
    setTopKDraft(String(cfg.topK));
  }, [cfg.topK]);

  return (
    <section className="flex min-h-[calc(100dvh-4rem)] flex-col gap-6">
      <div className="relative shrink-0">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="absolute left-0 top-0 inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Back"
              onClick={() => navigateBackOrFallback(navigate)}
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Back</TooltipContent>
        </Tooltip>
        <PageHeader heading="Settings" />
      </div>

      <div className="grid flex-1 gap-6 lg:grid-cols-2 lg:items-start">
        <Card size="sm" className="shadow-xs">
          <CardHeader>
            <CardTitle>Paths</CardTitle>
            <CardDescription>Indexed folders and noise filters</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-muted-foreground">Include</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Add include folder"
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
                  </TooltipTrigger>
                  <TooltipContent side="left">Add folder</TooltipContent>
                </Tooltip>
              </div>
              <div className="flex flex-col gap-2">
                {cfg.include.length === 0 ? (
                  <p className="text-sm text-muted-foreground">None</p>
                ) : (
                  cfg.include.map((p) => (
                    <div key={p} className="flex items-center justify-between gap-2 text-sm">
                      <div className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1.5 font-mono text-xs text-foreground">
                        {formatPathForDisplay(p, homePath)}
                      </div>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                            aria-label={`Remove include folder ${formatPathForDisplay(p, homePath)}`}
                            onClick={() => {
                              prepareRemoveIncludeFolder(p);
                            }}
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="left">Remove</TooltipContent>
                      </Tooltip>
                    </div>
                  ))
                )}
              </div>
            </div>

            <Separator />

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-muted-foreground">Exclude</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Add exclude folder"
                      onClick={async () => {
                        const dir = await pickFolder("Add exclude folder");
                        if (!dir) return;
                        if (cfg.exclude.includes(dir)) return;
                        updateConfig({ ...cfg, exclude: [...cfg.exclude, dir] });
                      }}
                    >
                      <FolderPlus className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="left">Add folder</TooltipContent>
                </Tooltip>
              </div>
              <div className="flex flex-col gap-2">
                {cfg.exclude.length === 0 ? (
                  <p className="text-sm text-muted-foreground">None</p>
                ) : (
                  cfg.exclude.map((p) => (
                    <div key={p} className="flex items-center justify-between gap-2 text-sm">
                      <div className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1.5 font-mono text-xs text-foreground">
                        {formatPathForDisplay(p, homePath)}
                      </div>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                            aria-label={`Remove exclude folder ${formatPathForDisplay(p, homePath)}`}
                            onClick={() =>
                              updateConfig({ ...cfg, exclude: cfg.exclude.filter((x) => x !== p) })
                            }
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="left">Remove</TooltipContent>
                      </Tooltip>
                    </div>
                  ))
                )}
              </div>
            </div>

            <Separator />

            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 flex-col gap-1">
                <Label htmlFor="default-excludes">Skip dependency / build folders</Label>
                <p className="text-xs text-muted-foreground">
                  e.g. <span className="font-mono">node_modules</span>,{" "}
                  <span className="font-mono">.git</span>, <span className="font-mono">dist</span>
                </p>
              </div>
              <Switch
                id="default-excludes"
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
          </CardContent>
        </Card>

        <div className="flex flex-col gap-6">
          <Card size="sm" className="shadow-xs">
            <CardHeader>
              <CardTitle>Search</CardTitle>
              <CardDescription>Types, ranking, UI</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label className="text-muted-foreground">File types</Label>
                <div className="flex flex-wrap gap-2">
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
                      size="sm"
                      className="h-auto min-w-0 px-3 py-1.5 font-medium data-[state=on]:border-emerald-200 data-[state=on]:bg-emerald-100 data-[state=on]:text-emerald-950 data-[state=off]:text-muted-foreground"
                    >
                      {ext}
                    </Toggle>
                  ))}
                </div>
              </div>

              <Separator />

              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Label className="text-muted-foreground">Ranking</Label>
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
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <Label htmlFor="topk" className="shrink-0 text-muted-foreground">
                      Result limit
                    </Label>
                    <Input
                      id="topk"
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      value={topKDraft}
                      className="h-9 w-20 text-right tabular-nums"
                      onChange={(e) => setTopKDraft(e.target.value)}
                      onBlur={() => {
                        const n = Number.parseInt(topKDraft.trim(), 10);
                        const next = Number.isNaN(n)
                          ? cfg.topK
                          : Math.max(1, Math.min(256, n));
                        updateConfig({ ...cfg, topK: next });
                        setTopKDraft(String(next));
                      }}
                    />
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Min score</span>
                      <span className="tabular-nums font-medium">
                        {Math.round(cfg.scoreThreshold * 100)}%
                      </span>
                    </div>
                    <Slider
                      min={0}
                      max={100}
                      step={1}
                      value={[Math.round(cfg.scoreThreshold * 100)]}
                      onValueChange={(value) => {
                        const next = value?.[0];
                        if (typeof next !== "number" || Number.isNaN(next)) return;
                        updateConfig({
                          ...cfg,
                          scoreThreshold: Math.max(0, Math.min(1, next / 100)),
                        });
                      }}
                      className="w-full"
                    />
                  </div>
                )}
              </div>

              <Separator />

              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="sim-hover" className="text-muted-foreground">
                  Similarity on hover
                </Label>
                <Switch
                  id="sim-hover"
                  checked={cfg.showSimilarityOnHover}
                  onCheckedChange={(checked) => {
                    updateConfig({ ...cfg, showSimilarityOnHover: checked });
                  }}
                  aria-label="Toggle similarity badge on hover"
                />
              </div>
            </CardContent>
          </Card>

          <Card size="sm" className="shadow-xs">
            <CardHeader>
              <CardTitle>Tags</CardTitle>
              <CardDescription>
                Name your tag, pick a color — shown in search cards and file view.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  id="tag-name"
                  type="text"
                  value={tagNameDraft}
                  onChange={(e) => setTagNameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addTagFromDraft();
                    }
                  }}
                  placeholder="Review"
                  autoComplete="off"
                  className="min-w-[8rem] flex-1"
                  aria-label="Tag name"
                />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <input
                      id="tag-color"
                      type="color"
                      value={tagColorDraft}
                      onChange={(e) => setTagColorDraft(e.target.value)}
                      className="size-9 shrink-0 cursor-pointer rounded-md border border-input bg-background p-0.5 shadow-xs"
                      aria-label="Tag color"
                    />
                  </TooltipTrigger>
                  <TooltipContent side="top">Pick color</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex shrink-0">
                      <Button
                        type="button"
                        variant="secondary"
                        size="icon"
                        disabled={!tagNameDraft.trim()}
                        aria-label="Add tag"
                        onClick={addTagFromDraft}
                      >
                        <Plus className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top">Add tag</TooltipContent>
                </Tooltip>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {tagsState.tags.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No tags</p>
                ) : (
                  tagsState.tags.map((t) => (
                    <TagDefBadge
                      key={t.id}
                      tag={t}
                      onRemove={() => {
                        const next = removeTagEverywhere(tagsState, t.id);
                        setTagsState(next);
                        saveTagsState(next);
                        const affected = Object.entries(tagsState.pathToTagIds)
                          .filter(([, ids]) => ids.includes(t.id))
                          .map(([p]) => p);
                        for (const p of affected) {
                          void syncPathTagsToQdrant(
                            cfg.sourceId,
                            p,
                            tagIdsForPath(next, p),
                          ).catch(() => {
                            /* ignore */
                          });
                        }
                      }}
                    />
                  ))
                )}
              </div>

              <Separator />

              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="auto-tagging" className="min-w-0">
                  Automatic Tagging
                </Label>
                <Switch
                  id="auto-tagging"
                  checked={cfg.autoTaggingEnabled}
                  onCheckedChange={(checked) => {
                    updateConfig({ ...cfg, autoTaggingEnabled: checked });
                  }}
                  aria-label="Toggle automatic tagging"
                  className="shrink-0"
                />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card
        size="sm"
        className="overflow-visible border-destructive/30 bg-destructive/5 shadow-xs ring-1 ring-destructive/20"
      >
        <CardContent className="flex min-w-0 flex-col gap-4 text-left sm:flex-row sm:items-start sm:justify-between sm:gap-8">
          <div className="min-w-0 flex-1 flex flex-col gap-1.5 text-pretty">
            <CardTitle className="text-left text-base leading-snug">Clear index</CardTitle>
            <CardDescription className="text-left">
              Drops embeddings in the local index ({liveIndexedCount ?? "—"} files). Files on disk are unchanged.
            </CardDescription>
            {clearIndexError ? (
              <p className="text-left text-sm font-medium text-destructive">{clearIndexError}</p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-start sm:pt-0.5">
            <AlertDialog open={confirmClearOpen} onOpenChange={setConfirmClearOpen}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex shrink-0">
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="destructive"
                        size="default"
                        className="h-9 min-w-9 px-3"
                        disabled={clearingIndex || liveIndexedCount === 0}
                        aria-label="Delete all vectors"
                      >
                        {clearingIndex ? (
                          <Spinner className="h-4 w-4 shrink-0" aria-hidden="true" />
                        ) : (
                          <Trash2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                        )}
                      </Button>
                    </AlertDialogTrigger>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top">Delete all vectors</TooltipContent>
              </Tooltip>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle className="text-black">
                    Delete all {liveIndexedCount} vectors?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    Clears all indexed vectors for this profile. Files are not deleted.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel
                    disabled={clearingIndex}
                    className="h-auto min-h-9 px-3 py-2"
                    aria-label="Cancel deletion"
                  >
                    Cancel
                  </AlertDialogCancel>
                  <AlertDialogAction
                    variant="destructive"
                    disabled={clearingIndex}
                    className="h-auto min-h-9 px-3 py-2"
                    aria-label="Delete vectors"
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
        </CardContent>
      </Card>

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
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={addIncludeLoading || includeToAdd === null}
              className="h-auto min-h-9 px-3 py-2"
              aria-label="Confirm add include folder"
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
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={removeIncludeLoading || includeToRemove === null}
              className="h-auto min-h-9 px-3 py-2"
              aria-label="Remove folder and vectors"
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

