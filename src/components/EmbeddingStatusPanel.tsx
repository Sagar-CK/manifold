import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { useMemo } from "react";
import { EmbeddingProgressBar } from "./EmbeddingProgressBar";
import { AppAlert } from "./AppAlert";
import { Button } from "./ui/button";
import { HugeIcon } from "./ui/huge-icon";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "./ui/tooltip";
import { fileNameFromPath } from "@/lib/files";
import { formatPathForDisplay } from "@/lib/pathDisplay";
import { isSetupRelatedError } from "@/lib/setupErrors";
import { useHomeDir } from "@/lib/useHomeDir";
import { cn } from "@/lib/utils";

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

function shortEmbedReason(reason: string, maxLen = 140): string {
  const jsonMessage = reason.match(/"message":\s*"([^"]+)"/)?.[1];
  if (jsonMessage) return jsonMessage;
  const stripped = reason
    .replace(/^embedding request failed:\s*/i, "")
    .replace(/^metadata embedding failed:\s*/i, "")
    .split("\n")[0]
    .trim();
  if (stripped.length <= maxLen) return stripped;
  return `${stripped.slice(0, maxLen)}…`;
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
  const reason = shortEmbedReason(failure.reason);

  return (
    <li className="flex items-start gap-2 rounded-md border border-destructive/15 bg-background/60 px-2 py-1.5">
      <div className="min-w-0 flex-1">
        <p
          className="truncate text-xs font-medium text-foreground"
          title={displayPath}
        >
          {fileName}
        </p>
        <p
          className="mt-0.5 line-clamp-2 text-[11px]/snug text-destructive/90"
          title={failure.reason}
        >
          {reason}
        </p>
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="shrink-0 text-muted-foreground hover:text-foreground"
            aria-label={`Dismiss error for ${fileName}`}
            onClick={() => onIgnore(failure.path)}
          >
            <HugeIcon icon={Cancel01Icon} className="size-3.5" aria-hidden />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left">Dismiss</TooltipContent>
      </Tooltip>
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
            "mt-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5",
            "max-h-48 overflow-y-auto sm:max-h-64",
          )}
          role="alert"
        >
          <p className="text-sm font-medium text-destructive">Embedding failed</p>
          <p className="mt-0.5 text-xs text-destructive/90">
            {uniqueFailures.length} file(s) failed to embed.
          </p>
          <ul className="mt-2 space-y-1.5">
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
