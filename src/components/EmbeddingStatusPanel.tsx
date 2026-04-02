import { EmbeddingProgressBar } from "./EmbeddingProgressBar";

type EmbeddingPhase =
  | "idle"
  | "scanning"
  | "embedding"
  | "paused"
  | "cancelling"
  | "done"
  | "error";

type EmbeddingFileFailure = {
  path: string;
  reason: string;
};

export function EmbeddingStatusPanel({
  embedding,
  hasPendingEmbeds,
  embeddingPhase,
  processed,
  total,
  lastEmbedError,
  embedFailures,
  indexedCount,
}: {
  embedding: boolean;
  hasPendingEmbeds: boolean;
  embeddingPhase: EmbeddingPhase;
  processed: number;
  total: number;
  lastEmbedError: string | null;
  embedFailures: EmbeddingFileFailure[];
  indexedCount?: number | null;
}) {
  const showIndexedCount =
    !embedding &&
    !hasPendingEmbeds &&
    typeof indexedCount === "number" &&
    indexedCount > 0;

  return (
    <div className="w-full max-w-sm">
      <EmbeddingProgressBar
        embedding={embedding}
        hasPendingEmbeds={hasPendingEmbeds}
        embeddingPhase={embeddingPhase}
        processed={processed}
        total={total}
      />
      {showIndexedCount ? (
        <div className="mt-2 text-center text-xs text-black/50">{indexedCount} file(s) indexed.</div>
      ) : null}
      {embedFailures.length > 0 ? (
        <div className="mt-2 text-center text-xs font-medium text-rose-700">
          {embedFailures.length} file(s) failed to embed. See logs for detail.
        </div>
      ) : lastEmbedError && lastEmbedError !== "Cancelled" ? (
        <div className="mt-2 text-center text-xs font-medium text-rose-700">
          Embedding encountered an error. See logs for detail.
        </div>
      ) : null}
    </div>
  );
}
