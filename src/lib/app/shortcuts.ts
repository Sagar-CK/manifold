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
    explanation: "Jump to Search",
    keys: ["mod", "K"],
  },
  {
    explanation: "Open File Visualizer",
    keys: ["mod", "G"],
  },
  {
    explanation: "Open Tags",
    keys: ["mod", "Shift", "T"],
  },
  {
    explanation: "Open Settings",
    keys: ["mod", ","],
  },
  {
    explanation: "Show Keyboard Shortcuts",
    keys: ["mod", "/"],
  },
];

export const CONTEXT_SHORTCUTS: readonly ShortcutDefinition[] = [
  {
    explanation: "Open File in Default App",
    keys: ["mod", "Click"],
  },
  {
    explanation: "Close Dialog",
    keys: ["Esc"],
  },
  {
    explanation: "Open File Detail",
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
