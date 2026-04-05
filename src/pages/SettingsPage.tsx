import { ArrowLeft } from "lucide-react";
import { useTheme } from "next-themes";
import { useNavigate } from "react-router-dom";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { SettingsAppearanceCard } from "../components/settings/SettingsAppearanceCard";
import { SettingsEmbeddingImageCard } from "../components/settings/SettingsEmbeddingImageCard";
import { SettingsClearIndexCard } from "../components/settings/SettingsClearIndexCard";
import type { IncludeFolderBreakdown } from "../components/settings/SettingsFolderDialogs";
import { SettingsFolderDialogs } from "../components/settings/SettingsFolderDialogs";
import { SettingsPathsCard } from "../components/settings/SettingsPathsCard";
import { SettingsSearchPreferencesCard } from "../components/settings/SettingsSearchPreferencesCard";
import { SettingsTagsCard } from "../components/settings/SettingsTagsCard";
import {
  SEARCH_MODE_OPTIONS,
  type SearchModeOption,
} from "../components/settings/searchModeOptions";
import { invokeErrorText } from "../lib/errors";
import { navigateBackOrFallback } from "../lib/navigateBack";
import {
  collapseIncludeFolders,
  type LocalConfig,
  type SupportedExt,
} from "../lib/localConfig";
import { saveConfig } from "../lib/localConfig";
import { useIndexedPointCount } from "../lib/qdrantPointCount";
import { useHomeDir } from "../lib/useHomeDir";
import { useTagsState } from "@/lib/useTagsState";
import {
  createTagDef,
  removePathMappingsUnderRoot,
  saveTagsState,
  type TagsState,
} from "../lib/tags";
import { useEmbeddingStatus } from "@/context/EmbeddingStatusContext";
import { PageHeader } from "../components/PageHeader";
import { EmbeddingStatusPanel } from "../components/EmbeddingStatusPanel";
import { Button } from "../components/ui/button";
import { ScrollArea } from "../components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../components/ui/tooltip";

function parseScanCount(value: number | string): number {
  const n = typeof value === "string" ? Number.parseInt(value, 10) : value;
  return Number.isFinite(n) ? n : 0;
}

export function SettingsPage({
  cfg,
  setCfg,
  extOptions,
}: {
  cfg: LocalConfig;
  setCfg: (next: LocalConfig) => void;
  extOptions: SupportedExt[];
}) {
  const {
    embedding,
    hasPendingEmbeds,
    embeddingPhase,
    embedProgress,
    lastEmbedError,
    embedFailures,
    cancelEmbedding,
  } = useEmbeddingStatus();
  const navigate = useNavigate();
  const homePath = useHomeDir();
  const [clearingIndex, setClearingIndex] = useState(false);
  const [clearIndexError, setClearIndexError] = useState<string | null>(null);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [embeddedCount, refetchEmbeddedCount] = useIndexedPointCount(cfg.sourceId, {
    refetchKey: clearingIndex,
  });
  const [includeToRemove, setIncludeToRemove] = useState<string | null>(null);
  const [confirmRemoveIncludeOpen, setConfirmRemoveIncludeOpen] =
    useState(false);
  const [removeIncludeLoading, setRemoveIncludeLoading] = useState(false);
  const [removeIncludeError, setRemoveIncludeError] = useState<string | null>(
    null,
  );
  const [confirmAddIncludeOpen, setConfirmAddIncludeOpen] = useState(false);
  const [addIncludeLoading, setAddIncludeLoading] = useState(false);
  const [addIncludeError, setAddIncludeError] = useState<string | null>(null);
  const [includeToAdd, setIncludeToAdd] = useState<string | null>(null);
  const [includeAddBreakdown, setIncludeAddBreakdown] =
    useState<IncludeFolderBreakdown | null>(null);
  const [
    confirmDisableDefaultExcludesOpen,
    setConfirmDisableDefaultExcludesOpen,
  ] = useState(false);
  const [tagsState, setTagsState] = useTagsState();
  const [tagNameDraft, setTagNameDraft] = useState("");
  const [tagColorDraft, setTagColorDraft] = useState("#6366f1");
  const [tagCreateOpen, setTagCreateOpen] = useState(false);
  const [topKDraft, setTopKDraft] = useState(() => String(cfg.topK));
  const { theme, setTheme } = useTheme();
  const [themeMounted, setThemeMounted] = useState(false);
  const liveIndexedCount =
    embedding || hasPendingEmbeds
      ? Math.max(embeddedCount ?? 0, embedProgress.processed)
      : embeddedCount;
  const selectedSearchModeOption: SearchModeOption | null =
    SEARCH_MODE_OPTIONS.find((option) => option.value === cfg.searchMode) ??
    null;

  function updateConfig(next: LocalConfig) {
    setCfg(next);
    saveConfig(next);
  }

  function updateTags(next: TagsState) {
    saveTagsState(next);
    setTagsState(next);
  }

  function addTagFromDraft(): boolean {
    if (!tagNameDraft.trim()) return false;
    const t = createTagDef(tagNameDraft, tagColorDraft);
    updateTags({ ...tagsState, tags: [...tagsState.tags, t] });
    setTagNameDraft("");
    return true;
  }

  async function refreshEmbeddedCount(sourceId: string) {
    await refetchEmbeddedCount(sourceId);
  }

  async function deleteAllVectors() {
    setClearIndexError(null);
    setClearingIndex(true);
    try {
      try {
        if (embedding || hasPendingEmbeds) {
          await cancelEmbedding();
        }
      } catch {
        // Job may have finished between render and invoke; still clear Qdrant.
      }
      await invoke("qdrant_delete_all_points", {
        args: { sourceId: cfg.sourceId },
      });
      // Bump sourceId to force a clean re-index cycle + avoid any stale per-source caches.
      const nextSourceId = crypto.randomUUID();
      updateConfig({ ...cfg, sourceId: nextSourceId, include: [] });
      setTagsState((prev) => {
        const next = { ...prev, pathToTagIds: {}, pendingAutoTags: {} };
        saveTagsState(next);
        return next;
      });
      await refreshEmbeddedCount(nextSourceId);
      setConfirmClearOpen(false);
    } catch (e) {
      setClearIndexError(invokeErrorText(e));
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
          await cancelEmbedding();
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
      setTagsState((prev) => {
        const next = removePathMappingsUnderRoot(prev, includeToRemove);
        saveTagsState(next);
        return next;
      });
      if (nextInclude.length === 0 && (embedding || hasPendingEmbeds)) {
        try {
          await cancelEmbedding();
        } catch {
          // ignore
        }
      }
      await refreshEmbeddedCount(cfg.sourceId);
      setConfirmRemoveIncludeOpen(false);
      setIncludeToRemove(null);
    } catch (e) {
      setRemoveIncludeError(invokeErrorText(e));
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
      setAddIncludeError(invokeErrorText(e));
    } finally {
      setAddIncludeLoading(false);
    }
  }

  function confirmAddIncludeFolder() {
    if (!includeToAdd) return;
    updateConfig({
      ...cfg,
      include: collapseIncludeFolders([...cfg.include, includeToAdd]),
    });
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
    setTopKDraft(String(cfg.topK));
  }, [cfg.topK]);

  useEffect(() => {
    setThemeMounted(true);
  }, []);

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col">
      <header className="shrink-0 px-4 pb-4 sm:px-5">
        <div className="relative">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute left-0 top-0 text-muted-foreground"
                aria-label="Back"
                onClick={() => navigateBackOrFallback(navigate)}
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Back</TooltipContent>
          </Tooltip>
          <PageHeader heading="Settings" />
        </div>
      </header>

      <ScrollArea className="min-h-0 h-full flex-1 overflow-hidden p-4">
        {/* Horizontal padding on both sides so card ring/shadow and radii are not clipped by the viewport */}
        <section className="flex min-w-0 flex-col gap-6 p-2">
          <div className="grid min-w-0 gap-6 lg:grid-cols-2 lg:items-start">
            <div className="flex min-w-0 flex-col gap-6">
              <SettingsAppearanceCard
                themeMounted={themeMounted}
                theme={theme}
                setTheme={setTheme}
              />

              <SettingsSearchPreferencesCard
                cfg={cfg}
                updateConfig={updateConfig}
                extOptions={extOptions}
                topKDraft={topKDraft}
                setTopKDraft={setTopKDraft}
                selectedSearchModeOption={selectedSearchModeOption}
              />

              <SettingsEmbeddingImageCard cfg={cfg} updateConfig={updateConfig} />

              <SettingsTagsCard
                cfg={cfg}
                updateConfig={updateConfig}
                tagsState={tagsState}
                setTagsState={setTagsState}
                tagCreateOpen={tagCreateOpen}
                setTagCreateOpen={setTagCreateOpen}
                tagNameDraft={tagNameDraft}
                setTagNameDraft={setTagNameDraft}
                tagColorDraft={tagColorDraft}
                setTagColorDraft={setTagColorDraft}
                addTagFromDraft={addTagFromDraft}
              />
            </div>

            <div className="flex min-w-0 flex-col gap-6">
              <SettingsPathsCard
                cfg={cfg}
                updateConfig={updateConfig}
                homePath={homePath}
                pickFolder={pickFolder}
                prepareAddIncludeFolder={prepareAddIncludeFolder}
                prepareRemoveIncludeFolder={prepareRemoveIncludeFolder}
                setConfirmDisableDefaultExcludesOpen={
                  setConfirmDisableDefaultExcludesOpen
                }
              />
            </div>
          </div>

          <SettingsClearIndexCard
            liveIndexedCount={liveIndexedCount}
            clearIndexError={clearIndexError}
            clearingIndex={clearingIndex}
            confirmClearOpen={confirmClearOpen}
            setConfirmClearOpen={setConfirmClearOpen}
            deleteAllVectors={deleteAllVectors}
          />

          <SettingsFolderDialogs
            cfg={cfg}
            updateConfig={updateConfig}
            confirmAddIncludeOpen={confirmAddIncludeOpen}
            onAddIncludeOpenChange={(open) => {
              setConfirmAddIncludeOpen(open);
              if (!open && !addIncludeLoading) {
                setIncludeToAdd(null);
                setIncludeAddBreakdown(null);
                setAddIncludeError(null);
              }
            }}
            addIncludeLoading={addIncludeLoading}
            includeAddBreakdown={includeAddBreakdown}
            addIncludeError={addIncludeError}
            includeToAdd={includeToAdd}
            confirmAddIncludeFolder={confirmAddIncludeFolder}
            confirmRemoveIncludeOpen={confirmRemoveIncludeOpen}
            onRemoveIncludeOpenChange={(open) => {
              setConfirmRemoveIncludeOpen(open);
              if (!open && !removeIncludeLoading) {
                setIncludeToRemove(null);
                setRemoveIncludeError(null);
              }
            }}
            removeIncludeLoading={removeIncludeLoading}
            removeIncludeError={removeIncludeError}
            includeToRemove={includeToRemove}
            removeIncludeFolderAndVectors={removeIncludeFolderAndVectors}
            confirmDisableDefaultExcludesOpen={
              confirmDisableDefaultExcludesOpen
            }
            setConfirmDisableDefaultExcludesOpen={
              setConfirmDisableDefaultExcludesOpen
            }
          />
        </section>
      </ScrollArea>
      <div className="shrink-0 pt-2">
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
    </div>
  );
}
