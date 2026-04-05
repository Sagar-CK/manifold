import { ListFilter } from "lucide-react";
import { TagFilterPill } from "@/components/TagFilterPill";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { TagDef } from "@/lib/tags";
import type { MatchTypeFilter } from "./searchTypes";

export function SearchQueryBar({
  query,
  onQueryChange,
  searchTypeMenuOpen,
  onSearchTypeMenuOpenChange,
  matchTypeFilter,
  onMatchTypeFilterChange,
  isSearching,
  tagDefs,
  tagFilterIds,
  onToggleTagFilter,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  searchTypeMenuOpen: boolean;
  onSearchTypeMenuOpenChange: (open: boolean) => void;
  matchTypeFilter: MatchTypeFilter;
  onMatchTypeFilterChange: (next: MatchTypeFilter) => void;
  isSearching: boolean;
  tagDefs: TagDef[];
  tagFilterIds: string[];
  onToggleTagFilter: (id: string) => void;
}) {
  const hasMatchTypeEnabled =
    matchTypeFilter.textMatch || matchTypeFilter.semantic;

  return (
    <div className="flex w-full flex-col">
      <InputGroup className="w-full">
        <InputGroupInput
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search across your files…"
          className="flex-1"
          aria-label="Search query"
        />
        <InputGroupAddon align="inline-end">
          <DropdownMenu
            open={searchTypeMenuOpen}
            onOpenChange={onSearchTypeMenuOpenChange}
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <DropdownMenuTrigger asChild>
                    <InputGroupButton
                      variant={hasMatchTypeEnabled ? "ghost" : "secondary"}
                      size="icon-xs"
                      aria-label="Filter search types"
                    >
                      <ListFilter className="size-3.5" />
                    </InputGroupButton>
                  </DropdownMenuTrigger>
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom">Filter search types</TooltipContent>
            </Tooltip>
            <DropdownMenuContent
              align="end"
              onPointerLeave={() => onSearchTypeMenuOpenChange(false)}
            >
              <DropdownMenuGroup>
                <DropdownMenuCheckboxItem
                  checked={matchTypeFilter.textMatch}
                  onSelect={(event) => event.preventDefault()}
                  onCheckedChange={(checked) => {
                    if (checked !== true && !matchTypeFilter.semantic) return;
                    onMatchTypeFilterChange({
                      ...matchTypeFilter,
                      textMatch: checked === true,
                    });
                  }}
                >
                  Text match
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={matchTypeFilter.semantic}
                  onSelect={(event) => event.preventDefault()}
                  onCheckedChange={(checked) => {
                    if (checked !== true && !matchTypeFilter.textMatch) return;
                    onMatchTypeFilterChange({
                      ...matchTypeFilter,
                      semantic: checked === true,
                    });
                  }}
                >
                  Semantic
                </DropdownMenuCheckboxItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          {isSearching ? <Spinner className="size-3.5" /> : null}
        </InputGroupAddon>
      </InputGroup>
      {tagDefs.length > 0 ? (
        <div className="mt-2 w-full text-center">
          <div className="inline-flex max-w-full flex-wrap items-center justify-center gap-2">
            {tagDefs.map((t) => {
              const on = tagFilterIds.includes(t.id);
              return (
                <TagFilterPill
                  key={t.id}
                  tag={t}
                  pressed={on}
                  onPressedChange={() => onToggleTagFilter(t.id)}
                  ariaLabel={`Filter by tag ${t.name}`}
                />
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
