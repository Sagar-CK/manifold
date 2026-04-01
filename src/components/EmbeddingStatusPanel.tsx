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
}: {
  embedding: boolean;
  hasPendingEmbeds: boolean;
  embeddingPhase: EmbeddingPhase;
  processed: number;
  total: number;
  lastEmbedError: string | null;
  embedFailures: EmbeddingFileFailure[];
}) {
  return (
    <div className="w-full max-w-sm">
      <EmbeddingProgressBar
        embedding={embedding}
        hasPendingEmbeds={hasPendingEmbeds}
        embeddingPhase={embeddingPhase}
        processed={processed}
        total={total}
      />
      {lastEmbedError ? (
        <div className="mt-2 text-center text-xs font-medium text-rose-700">{lastEmbedError}</div>
      ) : null}
      {embedFailures.length > 0 ? (
        <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          <div className="font-semibold">Failed files ({embedFailures.length})</div>
          <div className="mt-1 space-y-1">
            {embedFailures.map((failure) => (
              <div key={`${failure.path}:${failure.reason}`} className="break-all">
                <span className="font-medium">{failure.path}</span>: {failure.reason}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
