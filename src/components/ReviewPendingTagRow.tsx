import { Check, X } from "lucide-react";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";
import { TagDefLabel } from "./TagDefBadge";
import type { TagDef } from "../lib/tags";

function fileTypeLabel(ext: string) {
  const cleanExt = ext.replace(/^\./, "").trim().toUpperCase();
  return cleanExt || "FILE";
}

function fileNameFromPath(path: string) {
  const normalized = path.replace(/\\/g, "/");
  return normalized.split("/").pop() ?? path;
}

/**
 * Single pending suggestion: matches {@link FileSearchResultCard} (transparent tile: thumb + filename) + accept/reject.
 */
export function ReviewPendingTagRow({
  path,
  tag,
  thumbUrl,
  thumbFailed,
  thumbExpectLoading,
  showTagBadge = false,
  onAccept,
  onReject,
}: {
  path: string;
  tag: TagDef;
  thumbUrl?: string | null;
  thumbFailed: boolean;
  thumbExpectLoading: boolean;
  /** When true, show tag chip on the thumb (omit when suggestions are grouped by tag). */
  showTagBadge?: boolean;
  onAccept: () => void;
  onReject: () => void;
}) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const fileName = fileNameFromPath(path);

  return (
    <div className="group relative flex min-w-0 flex-col items-center gap-2 rounded-lg p-1">
      <div className="relative w-full px-1">
        {showTagBadge ? (
          <div className="absolute top-0.5 right-0.5 z-10 max-w-[min(100%-3rem,11rem)]">
            <TagDefLabel tag={tag} className="max-w-full truncate text-[10px]" />
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
      <div className="w-full min-w-0 truncate text-center text-xs font-normal leading-tight text-black/80" title={path}>
        {fileName}
      </div>
      <div className="flex items-center justify-center gap-0.5">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-8 text-emerald-600 hover:bg-emerald-100 hover:text-emerald-700"
          aria-label={`Accept tag ${tag.name} for ${fileName}`}
          onClick={onAccept}
        >
          <Check className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-8 text-destructive hover:bg-destructive/10"
          aria-label={`Reject tag ${tag.name} for ${fileName}`}
          onClick={onReject}
        >
          <X className="size-4" />
        </Button>
      </div>
    </div>
  );
}
