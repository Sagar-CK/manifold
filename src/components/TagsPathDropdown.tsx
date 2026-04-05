import type { Dispatch, SetStateAction } from "react";
import { runAutoTagOrchestration } from "@/lib/autoTagging";
import { Tags } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TagDefLabel } from "@/components/TagDefBadge";
import type { LocalConfig } from "@/lib/localConfig";
import { saveTagsState, tagIdsForPath, togglePathTag, type TagsState } from "@/lib/tags";
import { syncPathTagsToQdrant } from "@/lib/qdrantTags";

export function TagsPathDropdown({
  path,
  sourceId,
  tagsState,
  setTagsState,
  cfg,
}: {
  path: string;
  sourceId: string;
  tagsState: TagsState;
  setTagsState: Dispatch<SetStateAction<TagsState>>;
  cfg?: LocalConfig;
}) {
  if (tagsState.tags.length === 0) return null;

  return (
    <DropdownMenu>
      <span className="inline-flex">
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-white/95 text-black/55 shadow-sm ring-1 ring-black/10 hover:bg-white hover:text-black"
            aria-label="Tags"
          >
            <Tags className="size-2.5" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
      </span>
      <DropdownMenuContent align="end" className="w-52" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuGroup>
          {tagsState.tags.map((t) => (
            <DropdownMenuCheckboxItem
              key={t.id}
              checked={tagsState.pathToTagIds[path]?.includes(t.id) ?? false}
              onSelect={(e) => e.preventDefault()}
              onCheckedChange={() => {
                const next = togglePathTag(tagsState, path, t.id);
                setTagsState(next);
                saveTagsState(next);
                void syncPathTagsToQdrant(sourceId, path, tagIdsForPath(next, path)).catch(() => {
                  /* ignore offline qdrant errors */
                });
                if (cfg?.autoTaggingEnabled && tagIdsForPath(next, path).includes(t.id)) {
                  void runAutoTagOrchestration(cfg, path, t.id, next, setTagsState);
                }
              }}
            >
              <span className="min-w-0 flex-1">
                <TagDefLabel tag={t} className="pointer-events-none max-w-full" />
              </span>
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
