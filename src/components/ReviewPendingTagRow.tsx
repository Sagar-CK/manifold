import { Check, X } from "lucide-react";
import type { MouseEvent } from "react";
import { fileExtension, fileNameFromPath, fileTypeLabel } from "@/lib/files";
import type { TagDef } from "../lib/tags";
import { TagDefLabel } from "./TagDefBadge";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";

export function ReviewPendingTagRow({
  path,
  tag,
  thumbUrl,
  thumbFailed,
  thumbExpectLoading,
  showTagBadge = false,
  onAccept,
  onReject,
  onInspectFile,
}: {
  path: string;
  tag: TagDef;
  thumbUrl?: string | null;
  thumbFailed: boolean;
  thumbExpectLoading: boolean;
  showTagBadge?: boolean;
  onAccept: () => void;
  onReject: () => void;
  /** Preview click: plain → in-app file view; ⌘/Ctrl → open in default app (parent implements). */
  onInspectFile?: (e: MouseEvent<HTMLButtonElement>) => void;
}) {
  const ext = fileExtension(path);
  const fileName = fileNameFromPath(path);

  const previewBlock = (
    <>
      <div className="relative w-full px-1">
        {showTagBadge ? (
          <div className="absolute top-0.5 right-0.5 z-10 max-w-[min(100%-3rem,11rem)]">
            <TagDefLabel
              tag={tag}
              className="max-w-full truncate text-[10px]"
            />
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
      <div
        className="w-full min-w-0 truncate text-center text-xs font-normal leading-tight text-foreground"
        title={path}
      >
        {fileName}
      </div>
    </>
  );

  return (
    <div className="group relative flex min-w-0 flex-col items-center gap-2">
      {onInspectFile ? (
        <Button
          type="button"
          variant="ghost"
          className="h-auto w-full flex-col gap-2 rounded-xl border border-transparent p-2 text-left font-normal hover:border-border/70 hover:bg-muted/20"
          onClick={(e) => onInspectFile(e)}
          title="Click to view · ⌘ or Ctrl-click to open in default app"
          aria-label={`View file ${fileName}. Command or control click opens in default app.`}
        >
          {previewBlock}
        </Button>
      ) : (
        previewBlock
      )}
      <div className="flex items-center justify-center gap-0.5">
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          className="size-8 rounded-full border-border/70 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={`Accept tag ${tag.name} for ${fileName}`}
          onClick={onAccept}
        >
          <Check className="size-4" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          className="size-8 rounded-full border-border/70 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={`Reject tag ${tag.name} for ${fileName}`}
          onClick={onReject}
        >
          <X className="size-4" />
        </Button>
      </div>
    </div>
  );
}
