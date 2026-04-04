export type TagDef = {
  id: string;
  name: string;
  /** CSS color, e.g. #3b82f6 */
  color: string;
};

export type TagsState = {
  tags: TagDef[];
  /** Absolute file path → tag ids */
  pathToTagIds: Record<string, string[]>;
};

const KEY = "manifold:tags:v1";

function defaultState(): TagsState {
  return { tags: [], pathToTagIds: {} };
}

export function loadTagsState(): TagsState {
  if (typeof window === "undefined") return defaultState();
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw) as Partial<TagsState>;
    const tags = Array.isArray(parsed.tags)
      ? parsed.tags.filter(
          (t): t is TagDef =>
            typeof t === "object" &&
            t !== null &&
            typeof (t as TagDef).id === "string" &&
            typeof (t as TagDef).name === "string" &&
            typeof (t as TagDef).color === "string",
        )
      : [];
    const pathToTagIds =
      typeof parsed.pathToTagIds === "object" && parsed.pathToTagIds !== null
        ? parsed.pathToTagIds
        : {};
    return { tags, pathToTagIds };
  } catch {
    return defaultState();
  }
}

export function saveTagsState(state: TagsState): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(state));
}

export function createTagDef(name: string, color: string): TagDef {
  return {
    id: crypto.randomUUID(),
    name: name.trim() || "Untitled",
    color: color.trim() || "#64748b",
  };
}

export function tagIdsForPath(state: TagsState, path: string): string[] {
  return state.pathToTagIds[path] ?? [];
}

export function tagsForPath(state: TagsState, path: string): TagDef[] {
  const ids = new Set(tagIdsForPath(state, path));
  return state.tags.filter((t) => ids.has(t.id));
}

export function setPathTags(state: TagsState, path: string, tagIds: string[]): TagsState {
  const next = { ...state.pathToTagIds };
  if (tagIds.length === 0) {
    delete next[path];
  } else {
    next[path] = [...new Set(tagIds)];
  }
  return { ...state, pathToTagIds: next };
}

export function togglePathTag(state: TagsState, path: string, tagId: string): TagsState {
  const cur = new Set(tagIdsForPath(state, path));
  if (cur.has(tagId)) cur.delete(tagId);
  else cur.add(tagId);
  return setPathTags(state, path, [...cur]);
}

export function removeTagEverywhere(state: TagsState, tagId: string): TagsState {
  const tags = state.tags.filter((t) => t.id !== tagId);
  const pathToTagIds: Record<string, string[]> = {};
  for (const [p, ids] of Object.entries(state.pathToTagIds)) {
    const next = ids.filter((id) => id !== tagId);
    if (next.length > 0) pathToTagIds[p] = next;
  }
  return { tags, pathToTagIds };
}
