import type { Dispatch, SetStateAction } from "react";
import { Tags } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TagDefLabel } from "@/components/TagDefBadge";
import { saveTagsState, togglePathTag, type TagsState } from "@/lib/tags";

export function TagsPathDropdown({
  path,
  tagsState,
  setTagsState,
}: {
  path: string;
  tagsState: TagsState;
  setTagsState: Dispatch<SetStateAction<TagsState>>;
}) {
  if (tagsState.tags.length === 0) return null;

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
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
        </TooltipTrigger>
        <TooltipContent side="left">Tags</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-52" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuGroup>
          {tagsState.tags.map((t) => (
            <DropdownMenuCheckboxItem
              key={t.id}
              checked={tagsState.pathToTagIds[path]?.includes(t.id) ?? false}
              onSelect={(e) => e.preventDefault()}
              onCheckedChange={() => {
                setTagsState((prev) => {
                  const next = togglePathTag(prev, path, t.id);
                  saveTagsState(next);
                  return next;
                });
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
