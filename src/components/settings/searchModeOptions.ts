export const SEARCH_MODE_OPTIONS = [
  { value: "topK", label: "Top-K" },
  { value: "scoreThreshold", label: "Semantic score" },
] as const;

export type SearchModeOption = (typeof SEARCH_MODE_OPTIONS)[number];
