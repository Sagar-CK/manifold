export const SEARCH_QUERY_INPUT_ID = "manifold-search-query";

export type AppShortcutAction =
  | "search"
  | "graph"
  | "review-tags"
  | "settings"
  | "show-shortcuts";

export type ShortcutDefinition = {
  explanation: string;
  keys: readonly string[];
};

export const GLOBAL_SHORTCUTS: readonly ShortcutDefinition[] = [
  {
    explanation: "Jump to search",
    keys: ["mod", "K"],
  },
  {
    explanation: "Open graph explorer",
    keys: ["mod", "G"],
  },
  {
    explanation: "Review suggested tags",
    keys: ["mod", "Shift", "T"],
  },
  {
    explanation: "Open settings",
    keys: ["mod", ","],
  },
  {
    explanation: "Show keyboard shortcuts",
    keys: ["mod", "/"],
  },
];

export const CONTEXT_SHORTCUTS: readonly ShortcutDefinition[] = [
  {
    explanation: "Open file in default app",
    keys: ["mod", "Click"],
  },
  {
    explanation: "Close dialog",
    keys: ["Esc"],
  },
  {
    explanation: "Open file detail",
    keys: ["Double-click"],
  },
  {
    explanation: "Zoom",
    keys: ["Scroll wheel"],
  },
  {
    explanation: "Pan",
    keys: ["Drag"],
  },
];
