import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatIndexedPathForDisplay } from "@/lib/pathDisplay";

export type ContentHashPathPickerDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  paths: string[];
  homePath: string;
  includeRoots: string[];
  title: string;
  description: string;
  onSelectPath: (path: string) => void;
};

export function ContentHashPathPickerDialog({
  open,
  onOpenChange,
  paths,
  homePath,
  includeRoots,
  title,
  description,
  onSelectPath,
}: ContentHashPathPickerDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex max-h-64 flex-col gap-2 overflow-y-auto">
          {paths.map((path) => (
            <Tooltip key={path}>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-auto w-full justify-start rounded-xl border border-transparent p-1 font-normal hover:border-border/70 hover:bg-muted/20 focus-visible:border-border/70 focus-visible:bg-muted/20"
                  onClick={() => onSelectPath(path)}
                >
                  <span className="block min-w-0 w-full truncate rounded-lg bg-muted/20 px-2.5 py-1.5 font-mono text-xs text-foreground">
                    {formatIndexedPathForDisplay(path, homePath, includeRoots)}
                  </span>
                </Button>
              </TooltipTrigger>
              <TooltipContent
                side="bottom"
                className="max-w-md break-all font-mono text-xs"
              >
                {path}
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
