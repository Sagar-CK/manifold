import { createLocalStorageStore } from "./localStorageStore";

const MAX_IGNORED = 256;

export const ignoredEmbedFailuresStore = createLocalStorageStore<string[]>({
  key: "manifold:ignored-embed-failures",
  defaultValue: () => [],
  deserialize: (raw) => {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p): p is string => typeof p === "string");
  },
  serialize: (value) => JSON.stringify(value),
});

export function isEmbedFailureIgnored(path: string): boolean {
  return ignoredEmbedFailuresStore.getSnapshot().includes(path);
}

export function ignoreEmbedFailurePath(path: string): void {
  ignoredEmbedFailuresStore.setSnapshot((prev) => {
    if (prev.includes(path)) return prev;
    return [...prev, path].slice(-MAX_IGNORED);
  });
}

export function filterIgnoredEmbedFailures<
  T extends { path: string },
>(failures: T[]): T[] {
  const ignored = new Set(ignoredEmbedFailuresStore.getSnapshot());
  return failures.filter((f) => !ignored.has(f.path));
}
