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
        <div className="max-h-64 space-y-2 overflow-y-auto">
          {paths.map((path) => (
            <Tooltip key={path}>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-auto w-full justify-start p-0 font-normal hover:bg-transparent focus-visible:bg-transparent"
                  onClick={() => onSelectPath(path)}
                >
                  <span className="block min-w-0 w-full truncate rounded-md bg-muted px-2 py-1.5 font-mono text-xs text-foreground">
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
