import {
  AiMagicIcon,
  ArrowLeft01Icon,
  Delete02Icon,
  PlusSignIcon,
} from "@hugeicons/core-free-icons";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/app/PageHeader";
import { PageHeaderNav } from "@/components/app/PageHeaderNav";
import { FileSearchResultCard } from "@/components/files/FileSearchResultCard";
import { TagDefBadge, TagDefLabel } from "@/components/tags/TagDefBadge";
import { TagColorPicker } from "@/features/settings/components/TagColorPicker";
import { TAG_COLOR_DEFAULT } from "@/features/settings/components/tagColorPresets";
import type { LocalConfig } from "@/lib/config/localConfig";
import { openPathInDefaultApp as tryOpenPathInDefaultApp } from "@/lib/files";
import {
  pruneIndexedPathIfMissing,
  pruneMissingIndexedPathsFromList,
} from "@/lib/files/staleIndexedPaths";
import {
  isPreviewablePath,
  useThumbnailsForPaths,
} from "@/lib/files/useThumbnailsForPaths";
import { navigateToSearch } from "@/lib/navigation/navigateToSearch";
import {
  acceptAllPendingTagsForTag,
  acceptPendingTag,
  createTagDefinition,
  generatePendingTagSuggestionsForTag,
  rejectAllPendingTagsForTag,
  rejectPendingTag,
  removeTagDefinition,
  renameTagDefinition,
  updateTagColorDefinition,
} from "@/lib/tags/actions";
import { useTagsState } from "@/lib/tags/useTagsState";
import { ReviewPendingTagRow } from "@/pages/review-tags/components/ReviewPendingTagRow";
import { Button } from "../components/ui/button";
import { Field, FieldLabel } from "../components/ui/field";
import { HugeIcon } from "../components/ui/huge-icon";
import { Input } from "../components/ui/input";
import { ScrollArea } from "../components/ui/scroll-area";
import { createLogger } from "../lib/log";
import { type TagDef, tagsForPath } from "../lib/tags";

const reviewLog = createLogger("review-tags");

async function openPathInDefaultApp(path: string) {
  const error = await tryOpenPathInDefaultApp(path);
  if (error) {
    reviewLog.error("openPath failed", { path, error });
  }
}

function TagsManager({
  sourceId,
  tagsState,
  activeTagId,
  setActiveTagId,
}: {
  sourceId: string;
  tagsState: ReturnType<typeof useTagsState>[0];
  activeTagId: string | null;
  setActiveTagId: (tagId: string | null) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [editNameDraft, setEditNameDraft] = useState("");
  const [colorDraft, setColorDraft] = useState(TAG_COLOR_DEFAULT);
  const activeTag = activeTagId
    ? (tagsState.tags.find((tag) => tag.id === activeTagId) ?? null)
    : null;

  useEffect(() => {
    if (!activeTagId) return;
    const tag = tagsState.tags.find((t) => t.id === activeTagId);
    if (tag) return;
    setActiveTagId(null);
  }, [activeTagId, tagsState.tags]);

  useEffect(() => {
    setEditNameDraft(activeTag?.name ?? "");
  }, [activeTag?.name]);

  function selectTag(tag: TagDef) {
    setCreating(false);
    setActiveTagId(tag.id);
  }

  function commitActiveTagName() {
    if (!activeTag) return;
    const nextName = editNameDraft.trim();
    if (!nextName) {
      setEditNameDraft(activeTag.name);
      return;
    }
    if (nextName !== activeTag.name) {
      renameTagDefinition(activeTag.id, nextName);
    }
    setEditNameDraft(nextName);
  }

  function deleteActiveTag() {
    if (!activeTag) return;
    removeTagDefinition(activeTag.id, sourceId);
    setActiveTagId(null);
  }

  function addTag() {
    if (!nameDraft.trim()) return;
    createTagDefinition(nameDraft, colorDraft);
    setNameDraft("");
    setColorDraft(TAG_COLOR_DEFAULT);
    setCreating(false);
  }

  function startCreating() {
    setActiveTagId(null);
    setCreating(true);
    setNameDraft("");
    setColorDraft(TAG_COLOR_DEFAULT);
  }

  return (
    <section className="flex flex-col gap-3 text-left">
      <div className="grid gap-2 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
        <h2 className="text-xs/relaxed font-medium text-foreground">Tags</h2>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {tagsState.tags.map((tag) => (
            <TagDefBadge
              key={tag.id}
              tag={tag}
              selected={activeTagId === tag.id}
              onSelect={() => selectTag(tag)}
            />
          ))}
        </div>
        <Button
          type="button"
          variant="outline"
          className="justify-self-start sm:justify-self-end"
          onClick={startCreating}
        >
          <HugeIcon icon={PlusSignIcon} data-icon="inline-start" aria-hidden />
          Create tag
        </Button>
      </div>

      {activeTag ? (
        <div className="border-t border-border/60 pt-3">
          <div className="grid gap-3 sm:grid-cols-[minmax(10rem,16rem)_minmax(10rem,12rem)_auto] sm:items-end">
            <Field className="gap-2">
              <FieldLabel htmlFor={`tag-edit-name-${activeTag.id}`}>
                Name
              </FieldLabel>
              <Input
                id={`tag-edit-name-${activeTag.id}`}
                value={editNameDraft}
                onChange={(e) => setEditNameDraft(e.target.value)}
                onBlur={commitActiveTagName}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    e.currentTarget.blur();
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setEditNameDraft(activeTag.name);
                    e.currentTarget.blur();
                  }
                }}
                className="h-7"
                aria-label={`Rename tag ${activeTag.name}`}
              />
            </Field>
            <TagColorPicker
              id={`tag-edit-color-${activeTag.id}`}
              value={activeTag.color}
              onChange={(color) =>
                updateTagColorDefinition(activeTag.id, color)
              }
              className="gap-2"
              buttonClassName="h-7 w-full justify-start gap-1.5 px-2"
              swatchClassName="size-3"
            />
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="justify-self-start"
              onClick={deleteActiveTag}
            >
              <HugeIcon icon={Delete02Icon} data-icon="inline-start" />
              Delete tag
            </Button>
          </div>
        </div>
      ) : null}

      {creating ? (
        <div className="flex flex-col gap-3 border-t border-border/60 pt-3">
          <div className="grid gap-3 sm:grid-cols-[minmax(10rem,16rem)_minmax(10rem,12rem)_auto] sm:items-end">
            <Field className="gap-2">
              <FieldLabel htmlFor="review-tag-create-name">Name</FieldLabel>
              <Input
                id="review-tag-create-name"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTag();
                  }
                }}
                placeholder="Review"
                className="h-7"
                aria-label="New tag name"
              />
            </Field>
            <TagColorPicker
              id="review-tag-create-color"
              value={colorDraft}
              onChange={setColorDraft}
              className="gap-2"
              buttonClassName="h-7"
              swatchClassName="size-3"
            />
            <Button
              type="button"
              size="sm"
              disabled={!nameDraft.trim()}
              onClick={addTag}
            >
              Add Tag
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export function ReviewTagsPage({ cfg }: { cfg: LocalConfig }) {
  const { sourceId } = cfg;
  const navigate = useNavigate();
  const [tagsState] = useTagsState();
  const [activeTagId, setActiveTagId] = useState<string | null>(null);
  const [generatingTagId, setGeneratingTagId] = useState<string | null>(null);
  const activeTag = activeTagId
    ? (tagsState.tags.find((tag) => tag.id === activeTagId) ?? null)
    : null;

  const pendingPaths = Object.keys(tagsState.pendingAutoTags).filter(
    (p) => tagsState.pendingAutoTags[p]?.length > 0,
  );

  const assignedPaths = useMemo(() => {
    if (!activeTag) return [];
    return Object.entries(tagsState.pathToTagIds)
      .filter(([, tagIds]) => tagIds.includes(activeTag.id))
      .map(([path]) => path)
      .sort((a, b) => a.localeCompare(b));
  }, [activeTag, tagsState.pathToTagIds]);

  const thumbnailPaths = useMemo(
    () => Array.from(new Set([...pendingPaths, ...assignedPaths])),
    [pendingPaths, assignedPaths],
  );
  const thumbPathsKey = thumbnailPaths.join("\0");
  const { thumbByPath, thumbFailedByPath } = useThumbnailsForPaths(
    thumbPathsKey,
    thumbnailPaths,
    {
      onThumbError: (path, error) => {
        void pruneIndexedPathIfMissing(sourceId, path, error).catch(
          (cleanupError) => {
            reviewLog.warn("stale review thumbnail cleanup failed", {
              path,
              error: String(cleanupError),
            });
          },
        );
      },
    },
  );

  const hasPending = pendingPaths.length > 0;

  useEffect(() => {
    if (pendingPaths.length === 0) return;
    void pruneMissingIndexedPathsFromList(sourceId, pendingPaths).catch(
      (error) => {
        reviewLog.warn("review stale suggestion prune failed", {
          count: pendingPaths.length,
          error: String(error),
        });
      },
    );
  }, [sourceId, thumbPathsKey]);

  const pendingRows = useMemo(() => {
    const rows: Array<{
      path: string;
      tagId: string;
      key: string;
      tagDef: TagDef;
    }> = [];
    for (const path of pendingPaths) {
      for (const tagId of tagsState.pendingAutoTags[path] ?? []) {
        const tagDef = tagsState.tags.find((t) => t.id === tagId);
        if (!tagDef) continue;
        rows.push({ path, tagId, key: `${path}:${tagId}`, tagDef });
      }
    }
    return rows;
  }, [pendingPaths, tagsState.pendingAutoTags, tagsState.tags]);

  const sections = useMemo(() => {
    const map = new Map<string, { tagDef: TagDef; rows: typeof pendingRows }>();
    for (const row of pendingRows) {
      let g = map.get(row.tagId);
      if (!g) {
        g = { tagDef: row.tagDef, rows: [] };
        map.set(row.tagId, g);
      }
      g.rows.push(row);
    }
    const order = new Map(tagsState.tags.map((t, i) => [t.id, i] as const));
    return Array.from(map.entries())
      .map(([tagId, v]) => ({ tagId, tagDef: v.tagDef, rows: v.rows }))
      .sort(
        (a, b) => (order.get(a.tagId) ?? 999) - (order.get(b.tagId) ?? 999),
      );
  }, [pendingRows, tagsState.tags]);

  const activeSuggestionRows = useMemo(
    () =>
      activeTag ? pendingRows.filter((row) => row.tagId === activeTag.id) : [],
    [activeTag, pendingRows],
  );
  const suggestedTagCount = activeTag
    ? activeSuggestionRows.length
    : pendingRows.length;
  const canGenerateSuggestions =
    !!activeTag && assignedPaths.length > 0 && generatingTagId === null;

  const handleAccept = (path: string, tagId: string) => {
    acceptPendingTag(path, tagId, sourceId);
  };

  const handleReject = (path: string, tagId: string) => {
    rejectPendingTag(path, tagId);
  };

  const handleAcceptAllForTag = (tagId: string) => {
    acceptAllPendingTagsForTag(tagId, sourceId);
  };

  const handleRejectAllForTag = (tagId: string) => {
    rejectAllPendingTagsForTag(tagId);
  };

  async function handleGenerateSuggestions() {
    if (!activeTag || assignedPaths.length === 0) return;
    setGeneratingTagId(activeTag.id);
    try {
      await generatePendingTagSuggestionsForTag({
        cfg,
        tagId: activeTag.id,
        sourcePaths: assignedPaths,
      });
    } finally {
      setGeneratingTagId(null);
    }
  }

  function inspectFile(path: string, metaOpen: boolean) {
    if (metaOpen) {
      void openPathInDefaultApp(path);
      return;
    }
    navigate(`/file?path=${encodeURIComponent(path)}`, {
      state: { returnTo: "/review-tags" },
    });
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col">
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
          <PageHeader heading="Tags" />
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-6 px-4 sm:px-5">
        <TagsManager
          sourceId={sourceId}
          tagsState={tagsState}
          activeTagId={activeTagId}
          setActiveTagId={setActiveTagId}
        />

        <div className="flex min-h-0 flex-1 flex-col gap-6">
          <section className="flex flex-col gap-3">
            <div className="flex items-baseline gap-2">
              <h2 className="text-xs/relaxed font-medium text-foreground">
                Tagged files
              </h2>
              {activeTag ? (
                <span className="text-xs text-muted-foreground tabular-nums">
                  {assignedPaths.length}{" "}
                  {assignedPaths.length === 1 ? "file" : "files"}
                </span>
              ) : null}
            </div>
            {activeTag ? (
              assignedPaths.length > 0 ? (
                <ScrollArea className="max-h-[18rem] min-h-0">
                  <div className="grid grid-cols-2 gap-4 pb-1 pr-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                    {assignedPaths.map((path) => {
                      const preview = isPreviewablePath(path);
                      return (
                        <FileSearchResultCard
                          key={path}
                          path={path}
                          thumbUrl={thumbByPath[path] ?? null}
                          thumbFailed={!!thumbFailedByPath[path]}
                          thumbExpectLoading={
                            preview && !thumbFailedByPath[path]
                          }
                          tagDots={tagsForPath(tagsState, path)}
                          onClick={(e) =>
                            inspectFile(path, e.metaKey || e.ctrlKey)
                          }
                        />
                      );
                    })}
                  </div>
                </ScrollArea>
              ) : null
            ) : null}
          </section>

          <section className="flex min-h-0 flex-1 flex-col gap-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-baseline gap-2">
                <h2 className="text-xs/relaxed font-medium text-foreground">
                  Suggested files
                </h2>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {suggestedTagCount}{" "}
                  {suggestedTagCount === 1 ? "file" : "files"}
                </span>
              </div>
              {activeTag ? (
                <div className="flex flex-wrap gap-2 sm:justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!canGenerateSuggestions}
                    onClick={handleGenerateSuggestions}
                  >
                    <HugeIcon
                      icon={AiMagicIcon}
                      data-icon="inline-start"
                      aria-hidden
                    />
                    {generatingTagId === activeTag.id
                      ? "Suggesting..."
                      : "Suggest"}
                  </Button>
                  {activeSuggestionRows.length > 0 ? (
                    <>
                      <Button
                        type="button"
                        onClick={() => handleRejectAllForTag(activeTag.id)}
                        variant="outline"
                        size="sm"
                      >
                        Reject all
                      </Button>
                      <Button
                        type="button"
                        onClick={() => handleAcceptAllForTag(activeTag.id)}
                        size="sm"
                      >
                        Accept all
                      </Button>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>

            {activeTag ? (
              activeSuggestionRows.length > 0 ? (
                <ScrollArea className="min-h-0 flex-1">
                  <div className="grid grid-cols-2 gap-4 pb-8 pr-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                    {activeSuggestionRows.map(
                      ({ path, tagId: rowTagId, key, tagDef: rowTag }) => {
                        const preview = isPreviewablePath(path);
                        return (
                          <ReviewPendingTagRow
                            key={key}
                            path={path}
                            tag={rowTag}
                            showTagBadge={false}
                            thumbUrl={thumbByPath[path] ?? null}
                            thumbFailed={!!thumbFailedByPath[path]}
                            thumbExpectLoading={
                              preview && !thumbFailedByPath[path]
                            }
                            onAccept={() => handleAccept(path, rowTagId)}
                            onReject={() => handleReject(path, rowTagId)}
                            onInspectFile={(e) => {
                              inspectFile(path, e.metaKey || e.ctrlKey);
                            }}
                          />
                        );
                      },
                    )}
                  </div>
                </ScrollArea>
              ) : null
            ) : hasPending ? (
              <ScrollArea className="min-h-0 flex-1">
                <div className="flex flex-col gap-6 pb-8 pr-3">
                  {sections.map(({ tagId, tagDef, rows }) => (
                    <section key={tagId} className="flex flex-col gap-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <TagDefLabel tag={tagDef} />
                        <div className="flex flex-wrap gap-2 sm:justify-end">
                          <Button
                            type="button"
                            onClick={() => handleRejectAllForTag(tagId)}
                            variant="outline"
                            size="sm"
                          >
                            Reject all
                          </Button>
                          <Button
                            type="button"
                            onClick={() => handleAcceptAllForTag(tagId)}
                            size="sm"
                          >
                            Accept all
                          </Button>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                        {rows.map(
                          ({ path, tagId: rowTagId, key, tagDef: rowTag }) => {
                            const preview = isPreviewablePath(path);
                            return (
                              <ReviewPendingTagRow
                                key={key}
                                path={path}
                                tag={rowTag}
                                showTagBadge={false}
                                thumbUrl={thumbByPath[path] ?? null}
                                thumbFailed={!!thumbFailedByPath[path]}
                                thumbExpectLoading={
                                  preview && !thumbFailedByPath[path]
                                }
                                onAccept={() => handleAccept(path, rowTagId)}
                                onReject={() => handleReject(path, rowTagId)}
                                onInspectFile={(e) => {
                                  inspectFile(path, e.metaKey || e.ctrlKey);
                                }}
                              />
                            );
                          },
                        )}
                      </div>
                    </section>
                  ))}
                </div>
              </ScrollArea>
            ) : null}
          </section>
        </div>
      </div>
    </section>
  );
}
