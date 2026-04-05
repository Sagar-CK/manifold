import { Trash2 } from "lucide-react";
import { ErrorMessage } from "@/components/ErrorMessage";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function SettingsClearIndexCard({
  liveIndexedCount,
  clearIndexError,
  clearingIndex,
  confirmClearOpen,
  setConfirmClearOpen,
  deleteAllVectors,
}: {
  liveIndexedCount: number | null;
  clearIndexError: string | null;
  clearingIndex: boolean;
  confirmClearOpen: boolean;
  setConfirmClearOpen: (open: boolean) => void;
  deleteAllVectors: () => Promise<void>;
}) {
  return (
    <Card
      size="sm"
      className="overflow-visible border-destructive/30 bg-destructive/5 shadow-xs ring-1 ring-destructive/20"
    >
      <CardContent className="flex min-w-0 flex-col gap-4 text-left sm:flex-row sm:items-start sm:justify-between sm:gap-8">
        <div className="min-w-0 flex-1 flex flex-col gap-1.5 text-pretty">
          <CardTitle className="text-left text-base leading-snug">
            Clear index
          </CardTitle>
          <CardDescription className="text-left">
            Drops embeddings in the local index ({liveIndexedCount ?? "—"} files).
            Files on disk are unchanged.
          </CardDescription>
          <ErrorMessage variant="inline" message={clearIndexError} />
        </div>
        <div className="flex shrink-0 items-start sm:pt-0.5">
          <AlertDialog open={confirmClearOpen} onOpenChange={setConfirmClearOpen}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex shrink-0">
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="destructive"
                      size="default"
                      className="h-9 min-w-9 px-3"
                      disabled={clearingIndex || liveIndexedCount === 0}
                      aria-label="Delete all vectors"
                    >
                      {clearingIndex ? (
                        <Spinner
                          className="h-4 w-4 shrink-0"
                          aria-hidden="true"
                        />
                      ) : (
                        <Trash2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                      )}
                    </Button>
                  </AlertDialogTrigger>
                </span>
              </TooltipTrigger>
              <TooltipContent side="top">Delete all vectors</TooltipContent>
            </Tooltip>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle className="text-foreground">
                  Delete all {liveIndexedCount} vectors?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  Clears all indexed vectors for this profile. Files are not
                  deleted.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel
                  disabled={clearingIndex}
                  className="h-auto min-h-9 px-3 py-2"
                  aria-label="Cancel deletion"
                >
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  disabled={clearingIndex}
                  className="h-auto min-h-9 px-3 py-2"
                  aria-label="Delete vectors"
                  onClick={async (e) => {
                    e.preventDefault();
                    await deleteAllVectors();
                  }}
                >
                  {clearingIndex ? (
                    <>
                      <Spinner className="h-4 w-4" aria-hidden="true" />
                      Deleting...
                    </>
                  ) : (
                    "Delete"
                  )}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  );
}
