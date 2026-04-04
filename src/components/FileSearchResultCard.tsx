import { Skeleton } from "./ui/skeleton";

function fileTypeLabel(ext: string) {
  const cleanExt = ext.replace(/^\./, "").trim().toUpperCase();
  return cleanExt || "FILE";
}

export type FileSearchResultCardProps = {
  path: string;
  onClick: () => void;
  onMouseEnter?: () => void;
  thumbUrl?: string | null;
  thumbFailed: boolean;
  /** When true, show skeleton until thumbUrl or failure (previewable types only). */
  thumbExpectLoading: boolean;
  hoverChip?: string | null;
  title?: string;
};

export function FileSearchResultCard({
  path,
  onClick,
  onMouseEnter,
  thumbUrl,
  thumbFailed,
  thumbExpectLoading,
  hoverChip,
  title,
}: FileSearchResultCardProps) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const showChip = hoverChip != null && hoverChip !== "";

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      className="group relative flex min-w-0 flex-col items-center gap-2 rounded-lg p-1 transition-opacity hover:opacity-90"
      title={title ?? path}
    >
      {showChip ? (
        <div className="pointer-events-none absolute left-1/2 top-2 w-max -translate-x-1/2 rounded bg-black/75 px-2 py-1 text-[10px] font-medium leading-none tracking-wide text-white opacity-0 transition-opacity group-hover:opacity-100">
          {hoverChip}
        </div>
      ) : null}
      <div className="w-full px-1">
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
      <div className="w-full min-w-0">
        <div className="truncate text-center text-xs font-normal leading-tight text-black/80">
          {path.split("/").pop() ?? path}
        </div>
      </div>
    </button>
  );
}
