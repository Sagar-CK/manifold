import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useEmbeddingStatus } from "@/context/EmbeddingStatusContext";
import { useTagsState } from "@/lib/useTagsState";
import { cn } from "@/lib/utils";
import { EmbeddingStatusPanel } from "../components/EmbeddingStatusPanel";
import { PageHeader } from "../components/PageHeader";
import { SettingsAppearanceCard } from "../components/settings/SettingsAppearanceCard";
import { SettingsClearIndexCard } from "../components/settings/SettingsClearIndexCard";
import { SettingsEmbeddingImageCard } from "../components/settings/SettingsEmbeddingImageCard";
import type { IncludeFolderBreakdown } from "../components/settings/SettingsFolderDialogs";
import { SettingsFolderDialogs } from "../components/settings/SettingsFolderDialogs";
import { SettingsGeminiApiKeyCard } from "../components/settings/SettingsGeminiApiKeyCard";
import { SettingsPathsCard } from "../components/settings/SettingsPathsCard";
import { SettingsSearchPreferencesCard } from "../components/settings/SettingsSearchPreferencesCard";
import { SettingsTagsCard } from "../components/settings/SettingsTagsCard";
import { TAG_COLOR_DEFAULT } from "../components/settings/tagColorPresets";
import { Button } from "../components/ui/button";
import {
  FieldGroup,
  FieldLegend,
  FieldSeparator,
  FieldSet,
} from "../components/ui/field";
import { HugeIcon } from "../components/ui/huge-icon";
import { ScrollArea } from "../components/ui/scroll-area";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../components/ui/tooltip";
import {
  qdrantDeleteAllPoints,
  qdrantDeletePointsForIncludePath,
  scanFilesEstimate,
  showOpenDirectoryDialog,
} from "../lib/api/desktop";
import { invokeErrorText } from "../lib/errors";
import {
  collapseIncludeFolders,
  type LocalConfig,
  type SupportedExt,
} from "../lib/localConfig";
import { navigateBackOrFallback } from "../lib/navigateBack";
import { useIndexedPointCount } from "../lib/qdrantPointCount";
import { removePathMappingsUnderRoot } from "../lib/tags";
import { useHomeDir } from "../lib/useHomeDir";

function parseScanCount(value: number | string): number {
  const n = typeof value === "string" ? Number.parseInt(value, 10) : value;
  return Number.isFinite(n) ? n : 0;
}

export function SettingsPage({
  cfg,
  setCfg,
  extOptions,
  onGeminiApiKeySaved,
  onGeminiStoredKeyCleared,
}: {
  cfg: LocalConfig;
  setCfg: (next: LocalConfig) => void;
  extOptions: SupportedExt[];
  onGeminiApiKeySaved?: () => void;
  onGeminiStoredKeyCleared?: () => void;
}) {
  const {
    embedding,
    hasPendingEmbeds,
    embeddingPhase,
    embedProgress,
    lastEmbedError,
    embedFailures,
    ignoreEmbedFailure,
    cancelEmbedding,
  } = useEmbeddingStatus();
  const navigate = useNavigate();
  const homePath = useHomeDir();
  const [clearingIndex, setClearingIndex] = useState(false);
  const [clearIndexError, setClearIndexError] = useState<string | null>(null);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [embeddedCount, refetchEmbeddedCount] = useIndexedPointCount(
    cfg.sourceId,
    {
      refetchKey: clearingIndex,
    },
  );
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
  const [tagColorDraft, setTagColorDraft] = useState(TAG_COLOR_DEFAULT);
  const [tagCreateOpen, setTagCreateOpen] = useState(false);
  const [topKDraft, setTopKDraft] = useState(() => String(cfg.topK));
  const { theme, setTheme } = useTheme();
  const [themeMounted, setThemeMounted] = useState(false);
  const liveIndexedCount =
    embedding || hasPendingEmbeds
      ? Math.max(embeddedCount ?? 0, embedProgress.processed)
      : embeddedCount;
  const indexingActive = embedding || hasPendingEmbeds;
  const embeddingFooterSupplemental =
    embedFailures.length > 0 ||
    (lastEmbedError != null && lastEmbedError !== "Cancelled");

  function updateConfig(next: LocalConfig) {
    setCfg(next);
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
      await qdrantDeleteAllPoints(cfg.sourceId);
      // Bump sourceId to force a clean re-index cycle + avoid any stale per-source caches.
      const nextSourceId = crypto.randomUUID();
      updateConfig({ ...cfg, sourceId: nextSourceId, include: [] });
      setTagsState((prev) => ({
        ...prev,
        pathToTagIds: {},
        pendingAutoTags: {},
      }));
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
      await qdrantDeletePointsForIncludePath(cfg.sourceId, includeToRemove);
      const nextInclude = cfg.include.filter((x) => x !== includeToRemove);
      updateConfig({ ...cfg, include: nextInclude });
      setTagsState((prev) =>
        removePathMappingsUnderRoot(prev, includeToRemove),
      );
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
      const res = await scanFilesEstimate({
        include: [path],
        exclude: cfg.exclude,
        extensions: cfg.extensions,
        useDefaultFolderExcludes: cfg.useDefaultFolderExcludes,
      });
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
      const selection = await showOpenDirectoryDialog({
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
                <HugeIcon
                  icon={ArrowLeft01Icon}
                  className="h-4 w-4"
                  aria-hidden
                />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Back</TooltipContent>
          </Tooltip>
          <PageHeader heading="Settings" />
        </div>
      </header>

      <ScrollArea className="min-h-0 h-full flex-1 overflow-hidden">
        <section
          className={cn(
            "mx-auto flex min-w-0 max-w-2xl flex-col px-4 py-2 sm:px-5 sm:py-4",
            !indexingActive && "min-h-full",
          )}
        >
          <Tabs defaultValue="general" className="flex flex-col gap-6">
            <TabsList className="w-full sm:w-fit">
              <TabsTrigger value="general">General</TabsTrigger>
              <TabsTrigger value="indexing">Indexing</TabsTrigger>
              <TabsTrigger value="search">Search</TabsTrigger>
            </TabsList>

            <TabsContent value="general" className="flex flex-col gap-6 text-sm">
              <FieldSet>
                <FieldLegend>General</FieldLegend>
                <FieldGroup>
                  <SettingsAppearanceCard
                    themeMounted={themeMounted}
                    theme={theme}
                    setTheme={setTheme}
                  />
                  <SettingsGeminiApiKeyCard
                    onSaved={onGeminiApiKeySaved}
                    onStoredKeyCleared={onGeminiStoredKeyCleared}
                  />
                </FieldGroup>
              </FieldSet>
            </TabsContent>

            <TabsContent value="indexing" className="flex flex-col gap-6 text-sm">
              <FieldSet>
                <FieldLegend>Indexing</FieldLegend>
                <FieldGroup>
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
                  <FieldSeparator />
                  <SettingsEmbeddingImageCard
                    cfg={cfg}
                    updateConfig={updateConfig}
                  />
                </FieldGroup>
              </FieldSet>

              <SettingsClearIndexCard
                liveIndexedCount={liveIndexedCount}
                clearIndexError={clearIndexError}
                clearingIndex={clearingIndex}
                confirmClearOpen={confirmClearOpen}
                setConfirmClearOpen={setConfirmClearOpen}
                deleteAllVectors={deleteAllVectors}
              />
            </TabsContent>

            <TabsContent value="search" className="flex flex-col gap-6 text-sm">
              <FieldSet>
                <FieldLegend>Search</FieldLegend>
                <FieldGroup>
                  <SettingsSearchPreferencesCard
                    cfg={cfg}
                    updateConfig={updateConfig}
                    extOptions={extOptions}
                    topKDraft={topKDraft}
                    setTopKDraft={setTopKDraft}
                  />
                  <FieldSeparator />
                  <SettingsTagsCard
                    cfg={cfg}
                    updateConfig={updateConfig}
                    tagsState={tagsState}
                    tagCreateOpen={tagCreateOpen}
                    setTagCreateOpen={setTagCreateOpen}
                    tagNameDraft={tagNameDraft}
                    setTagNameDraft={setTagNameDraft}
                    tagColorDraft={tagColorDraft}
                    setTagColorDraft={setTagColorDraft}
                  />
                </FieldGroup>
              </FieldSet>
            </TabsContent>
          </Tabs>

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
      <div
        className={cn(
          "shrink-0 border-t border-border/50 bg-background/90 backdrop-blur-sm supports-[backdrop-filter]:bg-background/75",
          (indexingActive || embeddingFooterSupplemental) && "py-2",
        )}
      >
        <div className="flex min-h-0 items-center justify-center">
          <EmbeddingStatusPanel
            embedding={embedding}
            hasPendingEmbeds={hasPendingEmbeds}
            embeddingPhase={embeddingPhase}
            processed={embedProgress.processed}
            total={embedProgress.total}
            lastEmbedError={lastEmbedError}
            embedFailures={embedFailures}
            onIgnoreEmbedFailure={ignoreEmbedFailure}
          />
        </div>
      </div>
    </div>
  );
}
