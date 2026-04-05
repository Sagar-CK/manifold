import type { MouseEvent, ReactNode } from "react";
import { Skeleton } from "./ui/skeleton";

function fileTypeLabel(ext: string) {
  const cleanExt = ext.replace(/^\./, "").trim().toUpperCase();
  return cleanExt || "FILE";
}

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
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const showChip = hoverChip != null && hoverChip !== "";

  return (
    <button
      type="button"
      onClick={(e) => onClick(e)}
      onMouseEnter={onMouseEnter}
      className="group relative flex min-w-0 flex-col items-center gap-2 rounded-lg p-1 transition-opacity hover:opacity-90"
    >
      {showChip ? (
        <div className="pointer-events-none absolute left-1/2 top-2 z-[2] w-max -translate-x-1/2 rounded bg-black/75 px-2 py-1 text-[10px] font-medium leading-none tracking-wide text-white opacity-0 transition-opacity group-hover:opacity-100">
          {hoverChip}
        </div>
      ) : null}
      <div className="relative w-full px-1">
        {tagMenuSlot ? (
          <div
            className="absolute top-0.5 right-0.5 z-10"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {tagMenuSlot}
          </div>
        ) : null}
        {tagDots && tagDots.length > 0 ? (
          <div className="absolute bottom-1 left-1 z-[1] flex max-w-[calc(100%-2rem)] flex-wrap gap-0.5">
            {tagDots.map((t) => (
              <span
                key={t.id}
                role="img"
                aria-label={t.name}
                className="h-2 w-2 shrink-0 cursor-default rounded-full ring-1 ring-white/80"
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
              <div className="flex h-11 w-11 items-center justify-center rounded-md border border-black/10 bg-black/4">
                <span className="text-[10px] leading-none font-semibold uppercase tracking-wide text-black/60">
                  {fileTypeLabel(ext)}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="w-full min-w-0 truncate text-center text-xs font-normal leading-tight text-black/80">
        {path.split("/").pop() ?? path}
      </div>
    </button>
  );
}
