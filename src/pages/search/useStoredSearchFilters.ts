import type { Dispatch, SetStateAction } from "react";
import type { MatchTypeFilter } from "@/features/search/components/searchTypes";
import { useStoredState } from "@/hooks/useStoredState";

const MATCH_TYPE_FILTER_KEY = "manifold:search:matchTypeFilter:v2";
const TAG_FILTER_IDS_KEY = "manifold:search:tagFilterIds:v1";
const FILE_TYPE_FILTER_KEY = "manifold:search:fileTypeFilter:v1";

function defaultMatchTypeFilter(): MatchTypeFilter {
  return { text: true, ocr: true, semantic: true };
}

function normalizeMatchTypeFilter(value: unknown): MatchTypeFilter {
  if (typeof value !== "object" || value === null) {
    return defaultMatchTypeFilter();
  }
  const parsed = value as Record<string, unknown>;

  if (
    typeof parsed.text === "boolean" &&
    typeof parsed.ocr === "boolean" &&
    typeof parsed.semantic === "boolean"
  ) {
    if (!parsed.text && !parsed.ocr && !parsed.semantic) {
      return defaultMatchTypeFilter();
    }
    return {
      text: parsed.text,
      ocr: parsed.ocr,
      semantic: parsed.semantic,
    };
  }

  const textMatch =
    typeof parsed.textMatch === "boolean" ? parsed.textMatch : true;
  const semantic =
    typeof parsed.semantic === "boolean" ? parsed.semantic : true;
  if (!textMatch && !semantic) {
    return defaultMatchTypeFilter();
  }
  return {
    text: textMatch,
    ocr: textMatch,
    semantic,
  };
}

function normalizeTagFilterIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((id): id is string => typeof id === "string");
}

function normalizeFileTypeFilter(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const ext = item.trim().toLowerCase().replace(/^\.+/, "");
    if (!ext || seen.has(ext)) continue;
    seen.add(ext);
    out.push(ext);
  }
  return out;
}

export function useStoredSearchFilters(): {
  matchTypeFilter: MatchTypeFilter;
  setMatchTypeFilter: Dispatch<SetStateAction<MatchTypeFilter>>;
  tagFilterIds: string[];
  setTagFilterIds: Dispatch<SetStateAction<string[]>>;
  fileTypeFilter: string[];
  setFileTypeFilter: Dispatch<SetStateAction<string[]>>;
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
  const [fileTypeFilter, setFileTypeFilter] = useStoredState(
    FILE_TYPE_FILTER_KEY,
    () => [],
    normalizeFileTypeFilter,
  );

  return {
    matchTypeFilter,
    setMatchTypeFilter,
    tagFilterIds,
    setTagFilterIds,
    fileTypeFilter,
    setFileTypeFilter,
  };
}
