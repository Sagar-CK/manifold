import { useEffect, useMemo, useState } from "react";
import { Check, Pause, Play, X } from "lucide-react";
import { Button } from "./ui/button";
import { Progress } from "./ui/progress";

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

  const progressValue = useMemo(() => {
    if (total <= 0) return 0;
    return (processed / total) * 100;
  }, [processed, total]);

  const active = embedding || hasPendingEmbeds;

  useEffect(() => {
    if (active) {
      setIsVisible(true);
      setIsComplete(false);
      setIsFading(false);
      return;
    }
    if (embeddingPhase === "done") {
      setIsVisible(true);
      setIsComplete(true);
      setIsFading(false);
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
    return;
  }, [active, embeddingPhase]);

  if (!isVisible) return null;

  return (
    <div
      className={[
        "transition-all duration-500",
        isFading ? "opacity-0" : "opacity-100",
        compact ? "w-full max-w-sm" : "w-full",
      ].join(" ")}
    >
      <div className="mb-1 text-center text-xs text-black/50">
        Embedding {Math.max(0, processed)} / {total > 0 ? total : "..."} files
      </div>
      <div className="flex items-center gap-2">
        <Progress
          className="h-1.5 flex-1 transition-all duration-500"
          trackClassName={isComplete ? "bg-emerald-100" : "bg-black/10"}
          indicatorClassName={[
            "transition-all duration-500",
            isComplete ? "bg-emerald-500" : "bg-black",
          ].join(" ")}
          value={isComplete ? 100 : progressValue}
        />
        {isComplete ? <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" /> : null}
        {showControls && embedding ? (
          <div className="flex items-center gap-1">
            {embeddingPhase === "paused" ? (
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={controlsDisabled || !onResume}
                aria-label="Resume embedding"
                title="Resume"
                onClick={() => void onResume?.()}
              >
                <Play className="h-4 w-4" aria-hidden="true" />
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={controlsDisabled || !onPause || embeddingPhase === "cancelling"}
                aria-label="Pause embedding"
                title="Pause"
                onClick={() => void onPause?.()}
              >
                <Pause className="h-4 w-4" aria-hidden="true" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={controlsDisabled || !onCancel || embeddingPhase === "cancelling"}
              aria-label="Cancel embedding"
              title="Cancel"
              onClick={() => void onCancel?.()}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
