import { Tags } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { TagDefLabel } from "@/components/TagDefBadge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { LocalConfig } from "@/lib/localConfig";
import { toggleTagForPath } from "@/lib/tagActions";
import type { TagsState } from "@/lib/tags";

export function TagsPathDropdown({
  path,
  sourceId,
  tagsState,
  cfg,
}: {
  path: string;
  sourceId: string;
  tagsState: TagsState;
  cfg?: LocalConfig;
}) {
  const navigate = useNavigate();
  if (tagsState.tags.length === 0) return null;

  return (
    <DropdownMenu>
      <span className="inline-flex">
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon-xs"
            className="size-5 shrink-0 rounded-full border-border/70 bg-background p-0 text-muted-foreground shadow-none hover:bg-muted hover:text-foreground"
            aria-label="Tags"
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <Tags className="size-2.5" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
      </span>
      <DropdownMenuContent
        align="end"
        className="w-52"
        onClick={(e) => e.stopPropagation()}
      >
        <DropdownMenuGroup>
          {tagsState.tags.map((t) => (
            <DropdownMenuCheckboxItem
              key={t.id}
              checked={tagsState.pathToTagIds[path]?.includes(t.id) ?? false}
              onSelect={(e) => e.preventDefault()}
              onCheckedChange={() => {
                void toggleTagForPath({
                  path,
                  tagId: t.id,
                  sourceId,
                  cfg,
                  navigateToReviewTags: cfg
                    ? () => navigate("/review-tags")
                    : undefined,
                });
              }}
            >
              <span className="min-w-0 flex-1">
                <TagDefLabel
                  tag={t}
                  className="pointer-events-none max-w-full"
                />
              </span>
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
