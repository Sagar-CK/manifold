import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { type ReactNode, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { EmbeddingStatusPanel } from "@/components/app/EmbeddingStatusPanel";
import { PageHeader } from "@/components/app/PageHeader";
import { PageHeaderNav } from "@/components/app/PageHeaderNav";
import { useEmbeddingStatus } from "@/context/EmbeddingStatusContext";
import { SettingsClearIndexCard } from "@/features/settings/components/SettingsClearIndexCard";
import { SettingsEmbeddingImageCard } from "@/features/settings/components/SettingsEmbeddingImageCard";
import type { IncludeFolderBreakdown } from "@/features/settings/components/SettingsFolderDialogs";
import { SettingsFolderDialogs } from "@/features/settings/components/SettingsFolderDialogs";
import { SettingsGeminiApiKeyCard } from "@/features/settings/components/SettingsGeminiApiKeyCard";
import { SettingsPathsCard } from "@/features/settings/components/SettingsPathsCard";
import {
  SettingsFileTypesCard,
  SettingsSearchPreferencesCard,
} from "@/features/settings/components/SettingsSearchPreferencesCard";
import { SettingsTagsCard } from "@/features/settings/components/SettingsTagsCard";
import {
  collapseIncludeFolders,
  type LocalConfig,
  type SupportedExt,
} from "@/lib/config/localConfig";
import { navigateToSearch } from "@/lib/navigation/navigateToSearch";
import { useIndexedPointCount } from "@/lib/search/useIndexedPointCount";
import { useHomeDir } from "@/lib/system/useHomeDir";
import { useTagsState } from "@/lib/tags/useTagsState";
import { cn } from "@/lib/utils";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../components/ui/accordion";
import { Button } from "../components/ui/button";
import { FieldGroup } from "../components/ui/field";
import { HugeIcon } from "../components/ui/huge-icon";
import { ScrollArea } from "../components/ui/scroll-area";
import {
  qdrantDeleteAllPoints,
  qdrantDeletePointsForIncludePath,
  scanFilesEstimate,
  showOpenDirectoryDialog,
} from "../lib/api/desktop";
import { invokeErrorText } from "../lib/errors";
import { removePathMappingsUnderRoot } from "../lib/tags";

function parseScanCount(value: number | string): number {
  const n = typeof value === "string" ? Number.parseInt(value, 10) : value;
  return Number.isFinite(n) ? n : 0;
}

const SETTINGS_SECTION_IDS = ["general", "folders", "files", "search"] as const;

function SettingsSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <AccordionItem value={id} id={id} className="scroll-mt-4">
      <AccordionTrigger className="min-h-7 rounded-none border-b border-border/60 px-0 pb-1.5 pt-0 text-sm font-medium">
        {title}
      </AccordionTrigger>
      <AccordionContent className="pb-0 pt-3 text-sm">
        {children}
      </AccordionContent>
    </AccordionItem>
  );
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
    retryEmbedding,
    cancelEmbedding,
  } = useEmbeddingStatus();
  const navigate = useNavigate();
  const location = useLocation();
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
  const [, setTagsState] = useTagsState();
  const [topKDraft, setTopKDraft] = useState(() => String(cfg.topK));
  const [openSettingsSections, setOpenSettingsSections] = useState<string[]>(
    () => [...SETTINGS_SECTION_IDS],
  );
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
        defaultFolderExcludeSegments: cfg.defaultFolderExcludeSegments,
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
    if (!location.hash) return;
    let targetId = location.hash.slice(1);
    try {
      targetId = decodeURIComponent(targetId);
    } catch {
      // Keep the raw hash if decoding fails.
    }
    if (targetId === "index" || targetId === "tags") targetId = "general";
    setOpenSettingsSections((prev) =>
      prev.includes(targetId) ? prev : [...prev, targetId],
    );
    window.requestAnimationFrame(() => {
      document.getElementById(targetId)?.scrollIntoView({ block: "start" });
    });
  }, [location.hash]);

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col">
      <header className="shrink-0 px-4 pb-4 sm:px-5">
        <div className="relative">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute left-0 top-0 text-muted-foreground"
            aria-label="Search"
            onClick={() => navigateToSearch(navigate)}
          >
            <HugeIcon icon={ArrowLeft01Icon} className="h-4 w-4" aria-hidden />
          </Button>
          <PageHeaderNav />
          <PageHeader heading="Settings" />
        </div>
      </header>

      <ScrollArea className="min-h-0 h-full flex-1 overflow-hidden">
        <section
          className={cn(
            "mx-auto flex w-full min-w-0 max-w-5xl flex-col px-4 py-2 sm:px-5 sm:py-4",
            !indexingActive && "min-h-full",
          )}
        >
          <Accordion
            type="multiple"
            value={openSettingsSections}
            onValueChange={setOpenSettingsSections}
            className="gap-4 text-sm"
          >
            <SettingsSection id="general" title="General">
              <FieldGroup className="gap-3">
                <SettingsGeminiApiKeyCard
                  onSaved={onGeminiApiKeySaved}
                  onStoredKeyCleared={onGeminiStoredKeyCleared}
                />
                <SettingsClearIndexCard
                  liveIndexedCount={liveIndexedCount}
                  clearIndexError={clearIndexError}
                  clearingIndex={clearingIndex}
                  confirmClearOpen={confirmClearOpen}
                  setConfirmClearOpen={setConfirmClearOpen}
                  deleteAllVectors={deleteAllVectors}
                />
                <SettingsTagsCard cfg={cfg} updateConfig={updateConfig} />
              </FieldGroup>
            </SettingsSection>

            <SettingsSection id="folders" title="Folders">
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
            </SettingsSection>

            <SettingsSection id="files" title="Files">
              <FieldGroup className="gap-3">
                <SettingsFileTypesCard
                  cfg={cfg}
                  updateConfig={updateConfig}
                  extOptions={extOptions}
                />
                <SettingsEmbeddingImageCard
                  cfg={cfg}
                  updateConfig={updateConfig}
                />
              </FieldGroup>
            </SettingsSection>

            <SettingsSection id="search" title="Search">
              <SettingsSearchPreferencesCard
                cfg={cfg}
                updateConfig={updateConfig}
                topKDraft={topKDraft}
                setTopKDraft={setTopKDraft}
              />
            </SettingsSection>
          </Accordion>

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
            onRetryEmbedding={retryEmbedding}
          />
        </div>
      </div>
    </div>
  );
}
