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
  /** Absolute file path → pending auto-assigned tag ids */
  pendingAutoTags: Record<string, string[]>;
};

const KEY = "manifold:tags:v1";

/** Canonical path key so the same file always maps to one record (handles \\ vs /, trailing slashes). */
export function normalizePathKey(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

function defaultState(): TagsState {
  return { tags: [], pathToTagIds: {}, pendingAutoTags: {} };
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
    const pendingAutoTags =
      typeof parsed.pendingAutoTags === "object" && parsed.pendingAutoTags !== null
        ? parsed.pendingAutoTags
        : {};
    return { tags, pathToTagIds, pendingAutoTags };
  } catch {
    return defaultState();
  }
}

export function saveTagsState(state: TagsState): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(state));
  window.dispatchEvent(new Event("manifold:tags-updated"));
}

export function createTagDef(name: string, color: string): TagDef {
  return {
    id: crypto.randomUUID(),
    name: name.trim() || "Untitled",
    color: color.trim() || "#64748b",
  };
}

export function tagIdsForPath(state: TagsState, path: string): string[] {
  const k = normalizePathKey(path);
  const set = new Set<string>();
  for (const [p, ids] of Object.entries(state.pathToTagIds)) {
    if (normalizePathKey(p) !== k) continue;
    for (const id of ids) set.add(id);
  }
  return [...set];
}

/** Pending auto-tag ids for a path (merged across any alias keys). */
export function pendingTagIdsForPath(state: TagsState, path: string): string[] {
  const k = normalizePathKey(path);
  const set = new Set<string>();
  for (const [p, ids] of Object.entries(state.pendingAutoTags)) {
    if (normalizePathKey(p) !== k) continue;
    for (const id of ids) set.add(id);
  }
  return [...set];
}

export function tagsForPath(state: TagsState, path: string): TagDef[] {
  const ids = new Set(tagIdsForPath(state, path));
  return state.tags.filter((t) => ids.has(t.id));
}

export function setPathTags(state: TagsState, path: string, tagIds: string[]): TagsState {
  const k = normalizePathKey(path);
  const next = { ...state.pathToTagIds };
  for (const p of Object.keys(next)) {
    if (normalizePathKey(p) === k) delete next[p];
  }
  if (tagIds.length === 0) {
    return { ...state, pathToTagIds: next };
  }
  next[k] = [...new Set(tagIds)];
  return { ...state, pathToTagIds: next };
}

export function togglePathTag(state: TagsState, path: string, tagId: string): TagsState {
  const cur = new Set(tagIdsForPath(state, path));
  
  if (cur.has(tagId)) cur.delete(tagId);
  else cur.add(tagId);
  
  const nextState = setPathTags(state, path, [...cur]);
  
  // Also clear it from pending if the user manually toggled it
  const curPending = new Set(pendingTagIdsForPath(nextState, path));
  if (curPending.has(tagId)) {
    curPending.delete(tagId);
    const k = normalizePathKey(path);
    const nextPending = { ...nextState.pendingAutoTags };
    for (const p of Object.keys(nextPending)) {
      if (normalizePathKey(p) === k) delete nextPending[p];
    }
    if (curPending.size > 0) {
      nextPending[k] = [...curPending];
    }
    return { ...nextState, pendingAutoTags: nextPending };
  }
  
  return nextState;
}

export function removeTagEverywhere(state: TagsState, tagId: string): TagsState {
  const tags = state.tags.filter((t) => t.id !== tagId);
  const pathToTagIds: Record<string, string[]> = {};
  for (const [p, ids] of Object.entries(state.pathToTagIds)) {
    const next = ids.filter((id) => id !== tagId);
    if (next.length > 0) pathToTagIds[p] = next;
  }
  const pendingAutoTags: Record<string, string[]> = {};
  for (const [p, ids] of Object.entries(state.pendingAutoTags)) {
    const next = ids.filter((id) => id !== tagId);
    if (next.length > 0) pendingAutoTags[p] = next;
  }
  return { tags, pathToTagIds, pendingAutoTags };
}

/** Merge only; use `addPendingAutoTag` or `mergePendingAutoTagBatch` to persist. */
export function mergePendingAutoTag(state: TagsState, path: string, tagId: string): TagsState {
  const k = normalizePathKey(path);
  const cur = new Set(pendingTagIdsForPath(state, path));
  cur.add(tagId);
  const next = { ...state.pendingAutoTags };
  for (const p of Object.keys(next)) {
    if (normalizePathKey(p) === k) delete next[p];
  }
  next[k] = [...cur];
  return { ...state, pendingAutoTags: next };
}

export function addPendingAutoTag(state: TagsState, path: string, tagId: string): TagsState {
  const newState = mergePendingAutoTag(state, path, tagId);
  // Immediately persist pending auto-tags so they are available across instances/reloads
  saveTagsState(newState);
  return newState;
}

/** Apply several pending adds in one pass (avoids parallel `setTagsState` clobbering). */
export function mergePendingAutoTagBatch(
  state: TagsState,
  paths: string[],
  tagId: string,
): TagsState {
  let next = state;
  for (const path of paths) {
    next = mergePendingAutoTag(next, path, tagId);
  }
  return next;
}

/** Total (path × tag) pending rows — matches review UI list length. */
export function countPendingSuggestionPairs(state: TagsState): number {
  let n = 0;
  for (const ids of Object.values(state.pendingAutoTags)) {
    n += ids.length;
  }
  return n;
}

export function acceptPendingAutoTag(state: TagsState, path: string, tagId: string): TagsState {
  const k = normalizePathKey(path);
  const curPending = new Set(pendingTagIdsForPath(state, path));
  curPending.delete(tagId);
  const nextPending = { ...state.pendingAutoTags };
  for (const p of Object.keys(nextPending)) {
    if (normalizePathKey(p) === k) delete nextPending[p];
  }
  if (curPending.size > 0) {
    nextPending[k] = [...curPending];
  }

  const curIds = new Set(tagIdsForPath(state, path));
  curIds.add(tagId);
  const nextIds = { ...state.pathToTagIds };
  for (const p of Object.keys(nextIds)) {
    if (normalizePathKey(p) === k) delete nextIds[p];
  }
  nextIds[k] = [...curIds];

  return { ...state, pendingAutoTags: nextPending, pathToTagIds: nextIds };
}

export function rejectPendingAutoTag(state: TagsState, path: string, tagId: string): TagsState {
  const k = normalizePathKey(path);
  const curPending = new Set(pendingTagIdsForPath(state, path));
  curPending.delete(tagId);
  const nextPending = { ...state.pendingAutoTags };
  for (const p of Object.keys(nextPending)) {
    if (normalizePathKey(p) === k) delete nextPending[p];
  }
  if (curPending.size > 0) {
    nextPending[k] = [...curPending];
  }

  return { ...state, pendingAutoTags: nextPending };
}

export function acceptAllPendingAutoTags(state: TagsState): TagsState {
  let nextState = state;
  for (const [path, tagIds] of Object.entries(state.pendingAutoTags)) {
    for (const tagId of tagIds) {
      nextState = acceptPendingAutoTag(nextState, path, tagId);
    }
  }
  return nextState;
}

export function rejectAllPendingAutoTags(state: TagsState): TagsState {
  return { ...state, pendingAutoTags: {} };
}

/** Accept every pending suggestion for a single tag (all paths). */
export function acceptAllPendingForTag(state: TagsState, tagId: string): TagsState {
  let nextState = state;
  const paths = Object.keys(state.pendingAutoTags).filter((p) =>
    state.pendingAutoTags[p]?.includes(tagId),
  );
  for (const path of paths) {
    nextState = acceptPendingAutoTag(nextState, path, tagId);
  }
  return nextState;
}

/** Drop pending suggestions for `tagId` on every path. */
export function rejectAllPendingForTag(state: TagsState, tagId: string): TagsState {
  const nextPending = { ...state.pendingAutoTags };
  for (const path of Object.keys(nextPending)) {
    const ids = nextPending[path];
    if (!ids?.includes(tagId)) continue;
    const filtered = ids.filter((id) => id !== tagId);
    if (filtered.length === 0) delete nextPending[path];
    else nextPending[path] = filtered;
  }
  return { ...state, pendingAutoTags: nextPending };
}
