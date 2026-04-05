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
import { syncPathTagsToQdrant } from "@/lib/qdrantTags";
import {
  removeTagEverywhere,
  saveTagsState,
  tagIdsForPath,
  type TagsState,
} from "@/lib/tags";

export function SettingsTagsCard({
  cfg,
  updateConfig,
  tagsState,
  setTagsState,
  tagCreateOpen,
  setTagCreateOpen,
  tagNameDraft,
  setTagNameDraft,
  tagColorDraft,
  setTagColorDraft,
  addTagFromDraft,
}: {
  cfg: LocalConfig;
  updateConfig: (next: LocalConfig) => void;
  tagsState: TagsState;
  setTagsState: (next: TagsState | ((prev: TagsState) => TagsState)) => void;
  tagCreateOpen: boolean;
  setTagCreateOpen: (open: boolean) => void;
  tagNameDraft: string;
  setTagNameDraft: (v: string) => void;
  tagColorDraft: string;
  setTagColorDraft: (v: string) => void;
  addTagFromDraft: () => boolean;
}) {
  return (
    <>
      <Card size="sm" className="shadow-xs">
        <CardHeader className="items-center">
          <CardTitle>Tags</CardTitle>
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
                    if (addTagFromDraft()) setTagCreateOpen(false);
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
              <input
                id="tag-create-color"
                type="color"
                value={tagColorDraft}
                onChange={(e) => setTagColorDraft(e.target.value)}
                className="size-9 shrink-0 cursor-pointer rounded-md border border-input bg-background p-0.5 shadow-xs"
                aria-label="Tag color"
              />
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
                if (addTagFromDraft()) setTagCreateOpen(false);
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
