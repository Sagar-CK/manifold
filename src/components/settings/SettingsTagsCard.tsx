import { Plus } from "lucide-react";
import { TagDefBadge } from "@/components/TagDefBadge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import type { LocalConfig } from "@/lib/localConfig";
import { createTagDefinition, removeTagDefinition } from "@/lib/tagActions";
import type { TagsState } from "@/lib/tags";

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
      <Card size="sm" className="shadow-xs">
        <CardHeader className="items-center">
          <CardTitle className="app-section-title">Tags</CardTitle>
          <CardAction className="self-center">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setTagNameDraft("");
                setTagColorDraft("#6366f1");
                setTagCreateOpen(true);
              }}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add tag
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            {tagsState.tags.length === 0 ? (
              <p className="text-sm text-muted-foreground">No tags</p>
            ) : (
              tagsState.tags.map((t) => (
                <TagDefBadge
                  key={t.id}
                  tag={t}
                  onRemove={() => {
                    removeTagDefinition(t.id, cfg.sourceId);
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

      <Dialog
        open={tagCreateOpen}
        onOpenChange={(open) => {
          setTagCreateOpen(open);
          if (!open) {
            setTagNameDraft("");
            setTagColorDraft("#6366f1");
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
            <div className="flex flex-col gap-2">
              <Label htmlFor="tag-create-name">Name</Label>
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
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="tag-create-color">Color</Label>
              <div className="flex items-center gap-3">
                <input
                  id="tag-create-color"
                  type="color"
                  value={tagColorDraft}
                  onChange={(e) => setTagColorDraft(e.target.value)}
                  className="size-10 shrink-0 cursor-pointer rounded-xl border border-input bg-background p-1 shadow-xs"
                  aria-label="Tag color"
                />
                <div className="min-w-0 text-sm text-muted-foreground">
                  Used as a small accent dot and tag marker.
                </div>
              </div>
            </div>
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
