import { ListFilter } from "@hugeicons/core-free-icons";
import { TagFilterPill } from "@/components/tags/TagFilterPill";
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
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { SEARCH_QUERY_INPUT_ID } from "@/lib/app/shortcuts";
import type { TagDef } from "@/lib/tags";
import type { MatchTypeFilter } from "./searchTypes";

const MATCH_TYPE_OPTIONS = [
  { value: "ocr" as const, label: "OCR" },
  {
    value: "text" as const,
    label: "Text",
    title: "PDF page text or file name",
  },
  { value: "semantic" as const, label: "Semantic" },
];

const FILTER_TOGGLE_CLASS =
  "bg-muted text-muted-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-xs";

export function SearchQueryBar({
  query,
  onQueryChange,
  matchTypeFilter,
  onMatchTypeFilterChange,
  isSearching,
  tagDefs,
  tagFilterIds,
  onToggleTagFilter,
  availableFileTypes,
  fileTypeFilter,
  onFileTypeFilterChange,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  matchTypeFilter: MatchTypeFilter;
  onMatchTypeFilterChange: (next: MatchTypeFilter) => void;
  isSearching: boolean;
  tagDefs: TagDef[];
  tagFilterIds: string[];
  onToggleTagFilter: (id: string) => void;
  availableFileTypes: string[];
  fileTypeFilter: string[];
  onFileTypeFilterChange: (next: string[]) => void;
}) {
  const activeMatchTypes = MATCH_TYPE_OPTIONS.filter(
    (option) => matchTypeFilter[option.value],
  ).map((option) => option.value);

  const allMatchTypesEnabled =
    matchTypeFilter.ocr && matchTypeFilter.text && matchTypeFilter.semantic;
  const normalizedAvailableFileTypes = availableFileTypes.map((ext) =>
    ext.toLowerCase(),
  );
  const activeFileTypes =
    fileTypeFilter.length > 0 ? fileTypeFilter : normalizedAvailableFileTypes;
  const allFileTypesEnabled =
    fileTypeFilter.length === 0 ||
    fileTypeFilter.length === normalizedAvailableFileTypes.length;
  const filterMenuIsDefault = allMatchTypesEnabled && allFileTypesEnabled;

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
            <PopoverTrigger asChild>
              <InputGroupButton
                variant={filterMenuIsDefault ? "ghost" : "secondary"}
                size="icon-xs"
                className="relative"
                aria-label={
                  filterMenuIsDefault
                    ? "Search filters"
                    : "Search filters active"
                }
              >
                <HugeIcon
                  icon={ListFilter}
                  className="size-3.5"
                  strokeWidth={2}
                  aria-hidden
                />
                {!filterMenuIsDefault ? (
                  <span
                    className="absolute right-1 top-1 size-1.5 rounded-full bg-primary ring-2 ring-background"
                    aria-hidden
                  />
                ) : null}
              </InputGroupButton>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              side="bottom"
              sideOffset={6}
              className="w-72 gap-3 p-3"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs/relaxed font-medium text-foreground">
                  Filters
                </div>
                {!filterMenuIsDefault ? (
                  <button
                    type="button"
                    className="text-xs/relaxed text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      onMatchTypeFilterChange({
                        ocr: true,
                        text: true,
                        semantic: true,
                      });
                      onFileTypeFilterChange([]);
                    }}
                  >
                    Reset
                  </button>
                ) : null}
              </div>

              <div className="flex flex-col gap-2">
                <div className="text-[11px]/[1.2] font-medium text-muted-foreground">
                  Match source
                </div>
                <ToggleGroup
                  type="multiple"
                  value={activeMatchTypes}
                  onValueChange={(next) => {
                    const ocr = next.includes("ocr");
                    const text = next.includes("text");
                    const semantic = next.includes("semantic");
                    if (!ocr && !text && !semantic) return;
                    onMatchTypeFilterChange({ ocr, text, semantic });
                  }}
                  aria-label="Search match sources"
                  className="flex-wrap gap-1"
                >
                  {MATCH_TYPE_OPTIONS.map((option) => (
                    <ToggleGroupItem
                      key={option.value}
                      value={option.value}
                      title={option.title}
                      variant="outline"
                      className={`min-w-12 justify-center ${FILTER_TOGGLE_CLASS}`}
                    >
                      {option.label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>

              {normalizedAvailableFileTypes.length > 0 ? (
                <>
                  <Separator />
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-[11px]/[1.2] font-medium text-muted-foreground">
                        File type
                      </div>
                      {!allFileTypesEnabled ? (
                        <button
                          type="button"
                          className="text-[11px]/[1.2] text-muted-foreground hover:text-foreground"
                          onClick={() => onFileTypeFilterChange([])}
                        >
                          All
                        </button>
                      ) : null}
                    </div>
                    <ToggleGroup
                      type="multiple"
                      value={activeFileTypes}
                      onValueChange={(next) => {
                        if (
                          fileTypeFilter.length === 0 &&
                          next.length ===
                            normalizedAvailableFileTypes.length - 1
                        ) {
                          const toggled = normalizedAvailableFileTypes.find(
                            (ext) => !next.includes(ext),
                          );
                          onFileTypeFilterChange(toggled ? [toggled] : []);
                          return;
                        }

                        const selected = normalizedAvailableFileTypes.filter(
                          (ext) => next.includes(ext),
                        );
                        onFileTypeFilterChange(
                          selected.length ===
                            normalizedAvailableFileTypes.length
                            ? []
                            : selected,
                        );
                      }}
                      aria-label="Search file types"
                      className="flex-wrap gap-1"
                    >
                      {normalizedAvailableFileTypes.map((ext) => (
                        <ToggleGroupItem
                          key={ext}
                          value={ext}
                          variant="outline"
                          className={`min-w-12 justify-center lowercase ${FILTER_TOGGLE_CLASS}`}
                        >
                          {ext}
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                  </div>
                </>
              ) : null}
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
