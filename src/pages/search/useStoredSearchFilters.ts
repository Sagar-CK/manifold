import type { Dispatch, SetStateAction } from "react";
import type { MatchTypeFilter } from "@/components/search/searchTypes";
import { useStoredState } from "@/hooks/useStoredState";

const MATCH_TYPE_FILTER_KEY = "manifold:search:matchTypeFilter:v1";
const TAG_FILTER_IDS_KEY = "manifold:search:tagFilterIds:v1";

function defaultMatchTypeFilter(): MatchTypeFilter {
  return { textMatch: true, semantic: true };
}

function normalizeMatchTypeFilter(value: unknown): MatchTypeFilter {
  if (typeof value !== "object" || value === null) {
    return defaultMatchTypeFilter();
  }
  const parsed = value as Partial<MatchTypeFilter>;
  const textMatch =
    typeof parsed.textMatch === "boolean" ? parsed.textMatch : true;
  const semantic =
    typeof parsed.semantic === "boolean" ? parsed.semantic : true;
  if (!textMatch && !semantic) {
    return defaultMatchTypeFilter();
  }
  return { textMatch, semantic };
}

function normalizeTagFilterIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((id): id is string => typeof id === "string");
}

export function useStoredSearchFilters(): {
  matchTypeFilter: MatchTypeFilter;
  setMatchTypeFilter: Dispatch<SetStateAction<MatchTypeFilter>>;
  tagFilterIds: string[];
  setTagFilterIds: Dispatch<SetStateAction<string[]>>;
} {
  const [matchTypeFilter, setMatchTypeFilter] = useStoredState(
    MATCH_TYPE_FILTER_KEY,
    defaultMatchTypeFilter,
    normalizeMatchTypeFilter,
  );
  const [tagFilterIds, setTagFilterIds] = useStoredState(
    TAG_FILTER_IDS_KEY,
    () => [],
    normalizeTagFilterIds,
  );

  return {
    matchTypeFilter,
    setMatchTypeFilter,
    tagFilterIds,
    setTagFilterIds,
  };
}
