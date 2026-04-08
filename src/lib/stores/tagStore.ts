import { createLocalStorageStore } from "@/lib/stores/localStorageStore";
import { normalizeTagsState, type TagsState } from "@/lib/tags";

const KEY = "manifold:tags:v1";

function defaultState(): TagsState {
  return { tags: [], pathToTagIds: {}, pendingAutoTags: {} };
}

const store = createLocalStorageStore<TagsState>({
  key: KEY,
  defaultValue: defaultState,
  deserialize(raw) {
    return normalizeTagsState(JSON.parse(raw) as Partial<TagsState>);
  },
  serialize(value) {
    return JSON.stringify(normalizeTagsState(value));
  },
});

export function useTagStore(): [TagsState, typeof store.setSnapshot] {
  return store.useStore();
}

export const getTagSnapshot = store.getSnapshot;
export const setTagSnapshot = store.setSnapshot;
