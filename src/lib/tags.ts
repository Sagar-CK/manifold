import { normalizePathForMatch } from "./pathSelection";

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

export function normalizePathKey(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

function defaultState(): TagsState {
  return { tags: [], pathToTagIds: {}, pendingAutoTags: {} };
}

export function normalizeTagsState(parsed?: Partial<TagsState>): TagsState {
  const tags = Array.isArray(parsed?.tags)
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
    typeof parsed?.pathToTagIds === "object" && parsed.pathToTagIds !== null
      ? parsed.pathToTagIds
      : {};
  const pendingAutoTags =
    typeof parsed?.pendingAutoTags === "object" &&
    parsed.pendingAutoTags !== null
      ? parsed.pendingAutoTags
      : {};
  return { ...defaultState(), tags, pathToTagIds, pendingAutoTags };
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

function setPathTags(
  state: TagsState,
  path: string,
  tagIds: string[],
): TagsState {
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

export function togglePathTag(
  state: TagsState,
  path: string,
  tagId: string,
): TagsState {
  const cur = new Set(tagIdsForPath(state, path));

  if (cur.has(tagId)) cur.delete(tagId);
  else cur.add(tagId);

  const nextState = setPathTags(state, path, [...cur]);

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

export function removeTagEverywhere(
  state: TagsState,
  tagId: string,
): TagsState {
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

export function removePathEverywhere(
  state: TagsState,
  path: string,
): TagsState {
  const key = normalizePathKey(path);
  const pathToTagIds: Record<string, string[]> = { ...state.pathToTagIds };
  for (const existingPath of Object.keys(pathToTagIds)) {
    if (normalizePathKey(existingPath) === key) {
      delete pathToTagIds[existingPath];
    }
  }

  const pendingAutoTags: Record<string, string[]> = {
    ...state.pendingAutoTags,
  };
  for (const existingPath of Object.keys(pendingAutoTags)) {
    if (normalizePathKey(existingPath) === key) {
      delete pendingAutoTags[existingPath];
    }
  }

  return { ...state, pathToTagIds, pendingAutoTags };
}

/** Remove stored tag mappings for paths under an include root (vectors were deleted for those files). */
export function removePathMappingsUnderRoot(
  state: TagsState,
  includeRoot: string,
): TagsState {
  const root = normalizePathForMatch(includeRoot);
  if (!root) return state;

  const under = (path: string) => {
    const n = normalizePathForMatch(path);
    return n === root || n.startsWith(`${root}/`);
  };

  const pathToTagIds: Record<string, string[]> = { ...state.pathToTagIds };
  for (const p of Object.keys(pathToTagIds)) {
    if (under(p)) delete pathToTagIds[p];
  }

  const pendingAutoTags: Record<string, string[]> = {
    ...state.pendingAutoTags,
  };
  for (const p of Object.keys(pendingAutoTags)) {
    if (under(p)) delete pendingAutoTags[p];
  }

  return { ...state, pathToTagIds, pendingAutoTags };
}

function mergePendingAutoTag(
  state: TagsState,
  path: string,
  tagId: string,
): TagsState {
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

export function countPendingSuggestionPairs(state: TagsState): number {
  let n = 0;
  for (const ids of Object.values(state.pendingAutoTags)) {
    n += ids.length;
  }
  return n;
}

export function acceptPendingAutoTag(
  state: TagsState,
  path: string,
  tagId: string,
): TagsState {
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

export function rejectPendingAutoTag(
  state: TagsState,
  path: string,
  tagId: string,
): TagsState {
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

export function acceptAllPendingForTag(
  state: TagsState,
  tagId: string,
): TagsState {
  let nextState = state;
  const paths = Object.keys(state.pendingAutoTags).filter((p) =>
    state.pendingAutoTags[p]?.includes(tagId),
  );
  for (const path of paths) {
    nextState = acceptPendingAutoTag(nextState, path, tagId);
  }
  return nextState;
}

export function rejectAllPendingForTag(
  state: TagsState,
  tagId: string,
): TagsState {
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
