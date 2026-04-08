import type { MouseEvent, ReactNode } from "react";
import { fileExtension, fileTypeLabel } from "@/lib/files";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";

export type FileSearchResultCardProps = {
  path: string;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  onMouseEnter?: () => void;
  thumbUrl?: string | null;
  thumbFailed: boolean;
  /** When true, show skeleton until thumbUrl or failure (previewable types only). */
  thumbExpectLoading: boolean;
  hoverChip?: string | null;
  /** Small colored dots (name exposed via aria-label) */
  tagDots?: Array<{ id: string; name: string; color: string }>;
  /** Quick tag toggle UI (e.g. dropdown); clicks should call stopPropagation */
  tagMenuSlot?: ReactNode;
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
  tagMenuSlot,
}: FileSearchResultCardProps) {
  const ext = fileExtension(path);
  const showChip = hoverChip != null && hoverChip !== "";

  return (
    <Button
      type="button"
      variant="ghost"
      onClick={(e) => onClick(e)}
      onMouseEnter={onMouseEnter}
      className="group relative h-auto min-h-0 w-full min-w-0 flex-col gap-2 rounded-xl border border-transparent p-2 font-normal transition-colors hover:border-border/70 hover:bg-muted/20"
    >
      {showChip ? (
        <div className="pointer-events-none absolute left-1/2 top-2 z-[2] w-max -translate-x-1/2 rounded-full border border-border/70 bg-card/95 px-2.5 py-1 text-[10px] font-medium leading-none tracking-wide text-muted-foreground opacity-0 shadow-xs transition-opacity group-hover:opacity-100">
          {hoverChip}
        </div>
      ) : null}
      <div className="relative w-full px-1">
        {tagMenuSlot ? (
          <div className="absolute top-0.5 right-0.5 z-10">{tagMenuSlot}</div>
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
            <img
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
                <span className="app-label leading-none">
                  {fileTypeLabel(ext)}
                </span>
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
