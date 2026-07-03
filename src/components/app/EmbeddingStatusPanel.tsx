import { Cancel01Icon, ReloadIcon } from "@hugeicons/core-free-icons";
import { useMemo } from "react";
import { toast } from "sonner";
import { AppAlert } from "@/components/app/AppAlert";
import { Button } from "@/components/ui/button";
import { HugeIcon } from "@/components/ui/huge-icon";
import { fileNameFromPath, openPathInDefaultApp } from "@/lib/files";
import { formatPathForDisplay } from "@/lib/files/pathDisplay";
import { isSetupRelatedError } from "@/lib/setupErrors";
import { useHomeDir } from "@/lib/system/useHomeDir";
import { cn } from "@/lib/utils";
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

function indexingFailureReason(reason: string): string {
  return reason
    .replace(/\bmetadata embedding failed\b/gi, "metadata indexing failed")
    .replace(/\bembedding request failed\b/gi, "indexing request failed")
    .replace(/\bembeddings\b/gi, "indexing")
    .replace(/\bembedding\b/gi, "indexing")
    .replace(/\bembed\b/gi, "index");
}

function EmbedFailureRow({
  failure,
  homePath,
  onIgnore,
}: {
  failure: EmbeddingFileFailure;
  homePath: string;
  onIgnore: (path: string) => void;
}) {
  const displayPath = formatPathForDisplay(failure.path, homePath);
  const fileName = fileNameFromPath(failure.path);
  const reason = indexingFailureReason(failure.reason);

  async function openFailurePath() {
    const error = await openPathInDefaultApp(failure.path);
    if (error) {
      toast.error("Could not open file", {
        description: error,
      });
    }
  }

  return (
    <li className="min-w-0">
      <div className="group rounded-lg border border-border/70 transition-[background-color,border-color] hover:border-border hover:bg-muted/35 focus-within:border-border focus-within:bg-muted/35">
        <div className="flex min-h-7 items-center gap-1 pl-2.5">
          <button
            type="button"
            className="min-w-0 flex-1 truncate text-left text-xs font-medium text-foreground outline-none"
            title={displayPath}
            onClick={() => void openFailurePath()}
          >
            {fileName}
          </button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="mr-1 shrink-0 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={`Dismiss indexing failure for ${fileName}`}
            onClick={() => onIgnore(failure.path)}
          >
            <HugeIcon icon={Cancel01Icon} className="size-3" aria-hidden />
          </Button>
        </div>
        <p className="max-h-0 overflow-hidden px-2.5 text-[11px]/snug text-muted-foreground opacity-0 transition-[max-height,opacity,padding-bottom] duration-200 group-hover:max-h-16 group-hover:pb-2 group-hover:opacity-100 group-focus-within:max-h-16 group-focus-within:pb-2 group-focus-within:opacity-100">
          {reason}
        </p>
      </div>
    </li>
  );
}

export function EmbeddingStatusPanel({
  embedding,
  hasPendingEmbeds,
  embeddingPhase,
  processed,
  total,
  lastEmbedError,
  embedFailures,
  onIgnoreEmbedFailure,
  onRetryEmbedding,
  indexedCount,
}: {
  embedding: boolean;
  hasPendingEmbeds: boolean;
  embeddingPhase: EmbeddingPhase;
  processed: number;
  total: number;
  lastEmbedError: string | null;
  embedFailures: EmbeddingFileFailure[];
  onIgnoreEmbedFailure?: (path: string) => void;
  onRetryEmbedding?: () => void;
  indexedCount?: number | null;
}) {
  const homePath = useHomeDir();

  const uniqueFailures = useMemo(() => {
    const seen = new Set<string>();
    return embedFailures.filter((failure) => {
      if (seen.has(failure.path)) return false;
      seen.add(failure.path);
      return true;
    });
  }, [embedFailures]);

  const showIndexedCount =
    !embedding &&
    !hasPendingEmbeds &&
    typeof indexedCount === "number" &&
    indexedCount > 0;

  const operationalEmbedError =
    lastEmbedError &&
    lastEmbedError !== "Cancelled" &&
    !isSetupRelatedError(lastEmbedError)
      ? lastEmbedError
      : null;

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
        <div className="mt-2 text-center text-xs text-muted-foreground">
          {indexedCount} file(s) indexed.
        </div>
      ) : null}
      {uniqueFailures.length > 0 ? (
        <div
          className={cn(
            "mt-2 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2.5",
            "max-h-48 overflow-y-auto sm:max-h-64",
          )}
          role="alert"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="min-w-0 text-xs font-medium text-destructive">
              {uniqueFailures.length} file(s) failed to index
            </p>
            {onRetryEmbedding ? (
              <Button
                type="button"
                size="xs"
                variant="ghost"
                className="shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                disabled={embedding || hasPendingEmbeds}
                onClick={onRetryEmbedding}
              >
                <HugeIcon
                  icon={ReloadIcon}
                  data-icon="inline-start"
                  className="size-3"
                  aria-hidden
                />
                Retry
              </Button>
            ) : null}
          </div>
          <ul className="mt-2 flex flex-col gap-1">
            {uniqueFailures.map((failure) => (
              <EmbedFailureRow
                key={failure.path}
                failure={failure}
                homePath={homePath}
                onIgnore={onIgnoreEmbedFailure ?? (() => {})}
              />
            ))}
          </ul>
        </div>
      ) : operationalEmbedError ? (
        <div className="mt-2">
          <AppAlert variant="compact" message={operationalEmbedError} />
        </div>
      ) : null}
    </div>
  );
}
