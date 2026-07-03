import type { Dispatch, SetStateAction } from "react";
import { useTagStore } from "@/lib/stores/tagStore";
import type { TagsState } from "@/lib/tags";

export function useTagsState(): [
  TagsState,
  Dispatch<SetStateAction<TagsState>>,
] {
  return useTagStore();
}
