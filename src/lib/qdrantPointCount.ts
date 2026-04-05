import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export async function fetchQdrantPointCount(
  sourceId: string,
): Promise<number | null> {
  try {
    const res = (await invoke("qdrant_count_points", {
      args: { sourceId },
    })) as { count: number } | { count: string };
    const count =
      typeof res.count === "string"
        ? Number.parseInt(res.count, 10)
        : res.count;
    return Number.isFinite(count) ? count : 0;
  } catch {
    return null;
  }
}

export type IndexedPointCountEmbedSettle = {
  embedding: boolean;
  hasPendingEmbeds: boolean;
  embeddingPhase:
    | "idle"
    | "scanning"
    | "embedding"
    | "paused"
    | "cancelling"
    | "done"
    | "error";
};

export function useIndexedPointCount(
  sourceId: string,
  options?: {
    refetchKey?: unknown;
    refetchAfterEmbedSettles?: IndexedPointCountEmbedSettle;
  },
): [number | null, (overrideSourceId?: string) => Promise<void>] {
  const [count, setCount] = useState<number | null>(null);
  const refetchKey = options?.refetchKey;
  const settle = options?.refetchAfterEmbedSettles;

  const refetch = useCallback(async (overrideSourceId?: string) => {
    setCount(await fetchQdrantPointCount(overrideSourceId ?? sourceId));
  }, [sourceId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const n = await fetchQdrantPointCount(sourceId);
      if (!cancelled) setCount(n);
    })();
    return () => {
      cancelled = true;
    };
  }, [sourceId, refetchKey]);

  useEffect(() => {
    if (!settle) return;
    if (settle.embedding || settle.hasPendingEmbeds) return;
    if (
      settle.embeddingPhase !== "done" &&
      settle.embeddingPhase !== "idle" &&
      settle.embeddingPhase !== "error"
    ) {
      return;
    }
    let cancelled = false;
    void (async () => {
      const n = await fetchQdrantPointCount(sourceId);
      if (!cancelled) setCount(n);
    })();
    return () => {
      cancelled = true;
    };
  }, [
    sourceId,
    settle?.embedding,
    settle?.hasPendingEmbeds,
    settle?.embeddingPhase,
  ]);

  return [count, refetch];
}
