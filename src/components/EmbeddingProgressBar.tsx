import { Check, Pause, Play, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "./ui/button";
import { Progress } from "./ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

type EmbeddingPhase =
  | "idle"
  | "scanning"
  | "embedding"
  | "paused"
  | "cancelling"
  | "done"
  | "error";

export function EmbeddingProgressBar({
  embedding,
  hasPendingEmbeds,
  embeddingPhase,
  processed,
  total,
  compact = true,
  showControls = false,
  controlsDisabled = false,
  onPause,
  onResume,
  onCancel,
}: {
  embedding: boolean;
  hasPendingEmbeds: boolean;
  embeddingPhase: EmbeddingPhase;
  processed: number;
  total: number;
  compact?: boolean;
  showControls?: boolean;
  controlsDisabled?: boolean;
  onPause?: () => Promise<void>;
  onResume?: () => Promise<void>;
  onCancel?: () => Promise<void>;
}) {
  const [isVisible, setIsVisible] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [isFading, setIsFading] = useState(false);
  const prevPhaseRef = useRef<EmbeddingPhase>(embeddingPhase);

  const progressValue = useMemo(() => {
    if (total <= 0) return 0;
    return (processed / total) * 100;
  }, [processed, total]);
  const isScanning = embeddingPhase === "scanning";
  const hasKnownWork = total > 0 || processed > 0;
  const active =
    (embedding || hasPendingEmbeds) && (isScanning || hasKnownWork);

  useEffect(() => {
    const prevPhase = prevPhaseRef.current;
    const transitionedToDone =
      embeddingPhase === "done" &&
      (prevPhase === "scanning" ||
        prevPhase === "embedding" ||
        prevPhase === "paused" ||
        prevPhase === "cancelling");

    if (active) {
      setIsVisible(true);
      setIsComplete(false);
      setIsFading(false);
      prevPhaseRef.current = embeddingPhase;
      return;
    }
    if (transitionedToDone && hasKnownWork) {
      setIsVisible(true);
      setIsComplete(true);
      setIsFading(false);
      prevPhaseRef.current = embeddingPhase;
      const fadeTimer = window.setTimeout(() => {
        setIsFading(true);
      }, 850);
      const hideTimer = window.setTimeout(() => {
        setIsVisible(false);
      }, 1400);
      return () => {
        window.clearTimeout(fadeTimer);
        window.clearTimeout(hideTimer);
      };
    }
    setIsVisible(false);
    setIsComplete(false);
    setIsFading(false);
    prevPhaseRef.current = embeddingPhase;
    return;
  }, [active, embeddingPhase, hasKnownWork]);

  if (!isVisible) return null;

  return (
    <div
      className={[
        "transition-all duration-500",
        isFading ? "opacity-0" : "opacity-100",
        compact ? "w-full max-w-sm" : "w-full",
      ].join(" ")}
    >
      <div className="mb-1 text-center text-xs text-muted-foreground">
        {isScanning
          ? "Scanning files..."
          : `Indexing ${Math.max(0, processed)} / ${total > 0 ? total : "..."} files`}
      </div>
      <div className="flex items-center gap-2">
        {isScanning ? (
          <div className="embedding-scan-track h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-200/80">
            <div className="embedding-scan-indicator h-full w-2/5 rounded-full bg-zinc-400/80" />
          </div>
        ) : (
          <Progress
            className="h-1.5 flex-1 transition-all duration-500"
            trackClassName="bg-muted"
            indicatorClassName={[
              "transition-all duration-500",
              isComplete ? "bg-foreground/65" : "bg-primary",
            ].join(" ")}
            value={isComplete ? 100 : progressValue}
          />
        )}
        {isComplete ? (
          <Check
            className="h-3.5 w-3.5 text-muted-foreground"
            aria-hidden="true"
          />
        ) : null}
        {showControls && embedding ? (
          <div className="flex items-center gap-1">
            {embeddingPhase === "paused" ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={controlsDisabled || !onResume}
                    aria-label="Resume indexing"
                    onClick={() => void onResume?.()}
                  >
                    <Play className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">Resume</TooltipContent>
              </Tooltip>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={
                      controlsDisabled ||
                      !onPause ||
                      embeddingPhase === "cancelling"
                    }
                    aria-label="Pause indexing"
                    onClick={() => void onPause?.()}
                  >
                    <Pause className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">Pause</TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={
                    controlsDisabled ||
                    !onCancel ||
                    embeddingPhase === "cancelling"
                  }
                  aria-label="Cancel indexing"
                  onClick={() => void onCancel?.()}
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">Cancel</TooltipContent>
            </Tooltip>
          </div>
        ) : null}
      </div>
    </div>
  );
}
