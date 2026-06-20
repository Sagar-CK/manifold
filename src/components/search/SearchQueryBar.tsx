import { ListFilter } from "@hugeicons/core-free-icons";
import { TagFilterPill } from "@/components/TagFilterPill";
import { HugeIcon } from "@/components/ui/huge-icon";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SEARCH_QUERY_INPUT_ID } from "@/lib/appShortcuts";
import type { TagDef } from "@/lib/tags";
import type { MatchTypeFilter } from "./searchTypes";

const MATCH_TYPE_OPTIONS = [
  { value: "ocr" as const, label: "OCR" },
  { value: "text" as const, label: "Text", title: "PDF page text or file name" },
  { value: "semantic" as const, label: "Semantic" },
];

export function SearchQueryBar({
  query,
  onQueryChange,
  matchTypeFilter,
  onMatchTypeFilterChange,
  isSearching,
  tagDefs,
  tagFilterIds,
  onToggleTagFilter,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  matchTypeFilter: MatchTypeFilter;
  onMatchTypeFilterChange: (next: MatchTypeFilter) => void;
  isSearching: boolean;
  tagDefs: TagDef[];
  tagFilterIds: string[];
  onToggleTagFilter: (id: string) => void;
}) {
  const activeMatchTypes = MATCH_TYPE_OPTIONS.filter(
    (option) => matchTypeFilter[option.value],
  ).map((option) => option.value);

  const allMatchTypesEnabled =
    matchTypeFilter.ocr && matchTypeFilter.text && matchTypeFilter.semantic;

  return (
    <div className="flex w-full flex-col">
      <InputGroup className="w-full">
        <InputGroupInput
          id={SEARCH_QUERY_INPUT_ID}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search across your files…"
          className="flex-1"
          aria-label="Search query"
        />
        <InputGroupAddon align="inline-end">
          <Popover>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <PopoverTrigger asChild>
                    <InputGroupButton
                      variant={allMatchTypesEnabled ? "ghost" : "secondary"}
                      size="icon-xs"
                      aria-label="Search match types"
                    >
                      <HugeIcon
                        icon={ListFilter}
                        className="size-3.5"
                        strokeWidth={2}
                        aria-hidden
                      />
                    </InputGroupButton>
                  </PopoverTrigger>
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                Match types: OCR, text, semantic
              </TooltipContent>
            </Tooltip>
            <PopoverContent align="end" side="bottom" sideOffset={6} className="w-auto p-1">
              <ToggleGroup
                type="multiple"
                variant="segmented"
                spacing={0}
                value={activeMatchTypes}
                onValueChange={(next) => {
                  const ocr = next.includes("ocr");
                  const text = next.includes("text");
                  const semantic = next.includes("semantic");
                  if (!ocr && !text && !semantic) return;
                  onMatchTypeFilterChange({ ocr, text, semantic });
                }}
                aria-label="Search match types"
              >
                {MATCH_TYPE_OPTIONS.map((option) => (
                  <ToggleGroupItem
                    key={option.value}
                    value={option.value}
                    title={option.title}
                    className="px-2.5"
                  >
                    {option.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </PopoverContent>
          </Popover>
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
