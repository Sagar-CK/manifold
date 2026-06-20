import { PlusSignIcon } from "@hugeicons/core-free-icons";
import { TagDefBadge } from "@/components/TagDefBadge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { HugeIcon } from "@/components/ui/huge-icon";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { LocalConfig } from "@/lib/localConfig";
import { createTagDefinition, removeTagDefinition } from "@/lib/tagActions";
import type { TagsState } from "@/lib/tags";
import { TagColorPicker } from "./TagColorPicker";
import { TAG_COLOR_DEFAULT } from "./tagColorPresets";

export function SettingsTagsCard({
  cfg,
  updateConfig,
  tagsState,
  tagCreateOpen,
  setTagCreateOpen,
  tagNameDraft,
  setTagNameDraft,
  tagColorDraft,
  setTagColorDraft,
}: {
  cfg: LocalConfig;
  updateConfig: (next: LocalConfig) => void;
  tagsState: TagsState;
  tagCreateOpen: boolean;
  setTagCreateOpen: (open: boolean) => void;
  tagNameDraft: string;
  setTagNameDraft: (v: string) => void;
  tagColorDraft: string;
  setTagColorDraft: (v: string) => void;
}) {
  return (
    <>
      <FieldGroup>
        <Field>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <FieldLabel>Tags</FieldLabel>
              <FieldDescription>
                Labels for organizing and filtering search results.
              </FieldDescription>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => {
                setTagNameDraft("");
                setTagColorDraft(TAG_COLOR_DEFAULT);
                setTagCreateOpen(true);
              }}
            >
              <HugeIcon icon={PlusSignIcon} data-icon="inline-start" aria-hidden />
              Add tag
            </Button>
          </div>

          {tagsState.tags.length === 0 ? (
            <FieldDescription>
              No tags yet. Create one to mark files for review or other
              workflows.
            </FieldDescription>
          ) : (
            <div className="flex flex-wrap gap-2">
              {tagsState.tags.map((t) => (
                <TagDefBadge
                  key={t.id}
                  tag={t}
                  onRemove={() => {
                    removeTagDefinition(t.id, cfg.sourceId);
                  }}
                />
              ))}
            </div>
          )}
        </Field>

        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="auto-tagging">Automatic tagging</FieldLabel>
            <FieldDescription>
              Suggest tags from file content when indexing.
            </FieldDescription>
          </FieldContent>
          <Switch
            id="auto-tagging"
            checked={cfg.autoTaggingEnabled}
            onCheckedChange={(checked) => {
              updateConfig({ ...cfg, autoTaggingEnabled: checked });
            }}
            aria-label="Toggle automatic tagging"
          />
        </Field>
      </FieldGroup>

      <Dialog
        open={tagCreateOpen}
        onOpenChange={(open) => {
          setTagCreateOpen(open);
          if (!open) {
            setTagNameDraft("");
            setTagColorDraft(TAG_COLOR_DEFAULT);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New tag</DialogTitle>
            <DialogDescription>
              Name and color are shown on search cards and in the file view.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <Field>
              <FieldLabel htmlFor="tag-create-name">Name</FieldLabel>
              <Input
                id="tag-create-name"
                type="text"
                value={tagNameDraft}
                onChange={(e) => setTagNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (tagNameDraft.trim()) {
                      createTagDefinition(tagNameDraft, tagColorDraft);
                      setTagCreateOpen(false);
                    }
                  }
                }}
                placeholder="Review"
                autoComplete="off"
                autoFocus
                aria-label="Tag name"
              />
            </Field>
            <TagColorPicker
              value={tagColorDraft}
              onChange={setTagColorDraft}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setTagCreateOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!tagNameDraft.trim()}
              onClick={() => {
                if (!tagNameDraft.trim()) return;
                createTagDefinition(tagNameDraft, tagColorDraft);
                setTagCreateOpen(false);
              }}
            >
              Add tag
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
