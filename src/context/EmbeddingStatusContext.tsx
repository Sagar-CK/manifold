import { createContext, type ReactNode, useContext, useMemo } from "react";

export type EmbeddingJobPhase =
  | "idle"
  | "scanning"
  | "embedding"
  | "paused"
  | "cancelling"
  | "done"
  | "error";

export type EmbeddingStatusValue = {
  embedding: boolean;
  hasPendingEmbeds: boolean;
  embeddingPhase: EmbeddingJobPhase;
  embedProgress: { processed: number; total: number; status: string };
  lastEmbedError: string | null;
  embedFailures: Array<{ path: string; reason: string }>;
  cancelEmbedding: () => Promise<void>;
};

const EmbeddingStatusContext = createContext<EmbeddingStatusValue | null>(null);

export function EmbeddingStatusProvider({
  children,
  embedding,
  hasPendingEmbeds,
  embeddingPhase,
  embedProgress,
  lastEmbedError,
  embedFailures,
  cancelEmbedding,
}: {
  children: ReactNode;
  embedding: boolean;
  hasPendingEmbeds: boolean;
  embeddingPhase: EmbeddingJobPhase;
  embedProgress: { processed: number; total: number; status: string };
  lastEmbedError: string | null;
  embedFailures: Array<{ path: string; reason: string }>;
  cancelEmbedding: () => Promise<void>;
}) {
  const value = useMemo(
    (): EmbeddingStatusValue => ({
      embedding,
      hasPendingEmbeds,
      embeddingPhase,
      embedProgress,
      lastEmbedError,
      embedFailures,
      cancelEmbedding,
    }),
    [
      embedding,
      hasPendingEmbeds,
      embeddingPhase,
      embedProgress,
      lastEmbedError,
      embedFailures,
      cancelEmbedding,
    ],
  );

  return (
    <EmbeddingStatusContext.Provider value={value}>
      {children}
    </EmbeddingStatusContext.Provider>
  );
}

export function useEmbeddingStatus(): EmbeddingStatusValue {
  const ctx = useContext(EmbeddingStatusContext);
  if (!ctx) throw new Error("useEmbeddingStatus: missing provider");
  return ctx;
}
