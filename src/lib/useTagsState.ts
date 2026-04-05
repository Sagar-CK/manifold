import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { loadTagsState, type TagsState } from "@/lib/tags";

export function useTagsState(): [TagsState, Dispatch<SetStateAction<TagsState>>] {
  const [tagsState, setTagsState] = useState<TagsState>(() => loadTagsState());

  useEffect(() => {
    const onTagsUpdated = () => setTagsState(loadTagsState());
    window.addEventListener("manifold:tags-updated", onTagsUpdated);
    return () => window.removeEventListener("manifold:tags-updated", onTagsUpdated);
  }, []);

  return [tagsState, setTagsState];
}
