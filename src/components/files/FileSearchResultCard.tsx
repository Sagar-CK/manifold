import { MusicNote01Icon } from "@hugeicons/core-free-icons";
import type { MouseEvent } from "react";
import { Button } from "@/components/ui/button";
import { HugeIcon } from "@/components/ui/huge-icon";
import { ImgReveal } from "@/components/ui/img-reveal";
import { Skeleton } from "@/components/ui/skeleton";
import { fileExtension, fileTypeLabel } from "@/lib/files";
import { cn } from "@/lib/utils";

export type FileSearchResultCardProps = {
  path: string;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  onMouseEnter?: () => void;
  thumbUrl?: string | null;
  thumbFailed: boolean;
  /** When true, show skeleton until thumbUrl or failure (previewable types only). */
  thumbExpectLoading: boolean;
  hoverChip?: string | null;
  /** Small colored dots (name exposed via aria-label). */
  tagDots?: Array<{ id: string; name: string; color: string }>;
  matchType?: "semantic" | "text" | "ocr";
};

export function FileSearchResultCard({
  path,
  onClick,
  onMouseEnter,
  thumbUrl,
  thumbFailed,
  thumbExpectLoading,
  hoverChip,
  tagDots,
  matchType,
}: FileSearchResultCardProps) {
  const ext = fileExtension(path);
  const showChip = hoverChip != null && hoverChip !== "";
  const isTextMatch = matchType === "text";
  const isAudioFile = ext === "mp3" || ext === "wav";
  const matchBadge =
    matchType === "text" ? "Text" : matchType === "ocr" ? "OCR" : null;

  return (
    <Button
      type="button"
      variant="ghost"
      onClick={(e) => onClick(e)}
      onMouseEnter={onMouseEnter}
      className={cn(
        "group relative h-auto min-h-0 w-full min-w-0 flex-col gap-2 rounded-xl border p-2 font-normal shadow-sm transition-colors hover:border-border",
        isTextMatch
          ? "border-foreground/15 bg-muted/30 hover:bg-muted/40"
          : "border-border/50 bg-card/40 hover:bg-muted/25",
      )}
    >
      {showChip ? (
        <div className="pointer-events-none absolute left-1/2 top-2 z-[2] w-max -translate-x-1/2 rounded-full border border-border/70 bg-card/95 px-2 py-0.5 text-[11px] leading-none font-normal text-muted-foreground opacity-0 shadow-xs transition-opacity group-hover:opacity-100">
          {hoverChip}
        </div>
      ) : null}
      <div className="relative w-full px-1">
        {matchBadge ? (
          <div
            className={cn(
              "absolute top-0.5 left-0.5 z-10 rounded-full border px-1.5 py-0.5 text-[10px] leading-none shadow-xs",
              isTextMatch
                ? "border-foreground/15 bg-background/90 text-foreground"
                : "border-border/70 bg-background/85 text-muted-foreground",
            )}
          >
            {matchBadge}
          </div>
        ) : null}
        {tagDots && tagDots.length > 0 ? (
          <div className="absolute bottom-1 left-1 z-[1] flex max-w-[calc(100%-2rem)] flex-wrap gap-0.5">
            {tagDots.map((t) => (
              <span
                key={t.id}
                role="img"
                aria-label={t.name}
                className="h-2 w-2 shrink-0 cursor-default rounded-full ring-1 ring-background"
                style={{ backgroundColor: t.color }}
              />
            ))}
          </div>
        ) : null}
        {thumbUrl ? (
          <div className="mx-auto flex h-16 w-28 items-center justify-center">
            <ImgReveal
              src={thumbUrl}
              alt=""
              className="block max-h-full max-w-full rounded-lg object-contain"
            />
          </div>
        ) : (
          <div className="mx-auto flex h-16 w-28 items-center justify-center">
            {thumbExpectLoading && !thumbFailed ? (
              <Skeleton className="h-16 w-28 rounded-md" />
            ) : (
              <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-border/70 bg-muted/20">
                {isAudioFile ? (
                  <HugeIcon
                    icon={MusicNote01Icon}
                    className="size-5 text-muted-foreground"
                    aria-label={fileTypeLabel(ext)}
                  />
                ) : (
                  <span className="app-label leading-none">
                    {fileTypeLabel(ext)}
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="w-full min-w-0 truncate text-center text-xs font-normal leading-tight text-foreground/90">
        {path.split("/").pop() ?? path}
      </div>
    </Button>
  );
}
