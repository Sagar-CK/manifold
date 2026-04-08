export type ContentHashGroup<T> = {
  key: string;
  primary: T;
  variants: T[];
};

export function groupByContentHash<
  T extends { file: { path: string; contentHash: string } },
>(
  items: T[],
  choosePrimary: (currentPrimary: T, next: T) => T,
): ContentHashGroup<T>[] {
  const byHash = new Map<string, ContentHashGroup<T>>();
  for (const item of items) {
    const key = item.file.contentHash || item.file.path;
    const existing = byHash.get(key);
    if (!existing) {
      byHash.set(key, { key, primary: item, variants: [item] });
      continue;
    }
    existing.variants.push(item);
    existing.primary = choosePrimary(existing.primary, item);
  }
  return Array.from(byHash.values());
}
