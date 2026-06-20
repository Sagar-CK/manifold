import { Cancel01Icon, Tick01Icon } from "@hugeicons/core-free-icons";
import type { MouseEvent } from "react";
import { fileExtension, fileNameFromPath, fileTypeLabel } from "@/lib/files";
import type { TagDef } from "../lib/tags";
import { TagDefLabel } from "./TagDefBadge";
import { Button } from "./ui/button";
import { HugeIcon } from "./ui/huge-icon";
import { ImgReveal } from "./ui/img-reveal";
import { Skeleton } from "./ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "./ui/tooltip";

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

  const preview = (
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
                <span className="app-label leading-none">
                  {fileTypeLabel(ext)}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
      <div
        className="w-full min-w-0 truncate text-center text-xs font-normal leading-tight text-foreground/90"
        title={path}
      >
        {fileName}
      </div>
    </>
  );

  return (
    <div className="group flex min-w-0 flex-col items-center gap-1 rounded-xl border border-border/50 bg-card/40 p-2 shadow-sm transition-colors hover:border-border hover:bg-muted/20">
      {onInspectFile ? (
        <Button
          type="button"
          variant="ghost"
          className="h-auto w-full min-w-0 flex-col gap-1.5 rounded-lg border-0 bg-transparent p-0 font-normal shadow-none hover:bg-transparent"
          onClick={(e) => onInspectFile(e)}
          title="Click to view · ⌘ or Ctrl-click to open in default app"
          aria-label={`View file ${fileName}. Command or control click opens in default app.`}
        >
          {preview}
        </Button>
      ) : (
        preview
      )}
      <div className="flex items-center justify-center gap-0.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-7 text-muted-foreground"
              aria-label={`Reject tag ${tag.name} for ${fileName}`}
              onClick={onReject}
            >
              <HugeIcon icon={Cancel01Icon} className="size-3.5" aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Reject</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-7 text-muted-foreground hover:text-foreground"
              aria-label={`Accept tag ${tag.name} for ${fileName}`}
              onClick={onAccept}
            >
              <HugeIcon icon={Tick01Icon} className="size-3.5" aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Accept</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
