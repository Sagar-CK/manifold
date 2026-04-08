import { ErrorMessage } from "@/components/ErrorMessage";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Spinner } from "@/components/ui/spinner";
import type { LocalConfig } from "@/lib/localConfig";

export type IncludeFolderBreakdown = {
  total: number;
  textLike: number;
  image: number;
  audio: number;
  video: number;
};

export function SettingsFolderDialogs({
  cfg,
  updateConfig,
  confirmAddIncludeOpen,
  onAddIncludeOpenChange,
  addIncludeLoading,
  includeAddBreakdown,
  addIncludeError,
  includeToAdd,
  confirmAddIncludeFolder,
  confirmRemoveIncludeOpen,
  onRemoveIncludeOpenChange,
  removeIncludeLoading,
  removeIncludeError,
  includeToRemove,
  removeIncludeFolderAndVectors,
  confirmDisableDefaultExcludesOpen,
  setConfirmDisableDefaultExcludesOpen,
}: {
  cfg: LocalConfig;
  updateConfig: (next: LocalConfig) => void;
  confirmAddIncludeOpen: boolean;
  onAddIncludeOpenChange: (open: boolean) => void;
  addIncludeLoading: boolean;
  includeAddBreakdown: IncludeFolderBreakdown | null;
  addIncludeError: string | null;
  includeToAdd: string | null;
  confirmAddIncludeFolder: () => void;
  confirmRemoveIncludeOpen: boolean;
  onRemoveIncludeOpenChange: (open: boolean) => void;
  removeIncludeLoading: boolean;
  removeIncludeError: string | null;
  includeToRemove: string | null;
  removeIncludeFolderAndVectors: () => Promise<void>;
  confirmDisableDefaultExcludesOpen: boolean;
  setConfirmDisableDefaultExcludesOpen: (open: boolean) => void;
}) {
  return (
    <>
      <AlertDialog
        open={confirmAddIncludeOpen}
        onOpenChange={onAddIncludeOpenChange}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">
              Add folder
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="flex flex-col gap-3 text-muted-foreground">
                <p className="tabular-nums">
                  {addIncludeLoading
                    ? "Counting files…"
                    : includeAddBreakdown !== null
                      ? `${includeAddBreakdown.total.toLocaleString()} file${includeAddBreakdown.total === 1 ? "" : "s"}`
                      : "—"}
                </p>
                {!addIncludeLoading &&
                includeAddBreakdown !== null &&
                includeAddBreakdown.total > 0 ? (
                  <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 text-sm tabular-nums">
                    {includeAddBreakdown.textLike > 0 ? (
                      <>
                        <span>Text / PDF</span>
                        <span className="text-right">
                          {includeAddBreakdown.textLike.toLocaleString()}
                        </span>
                      </>
                    ) : null}
                    {includeAddBreakdown.image > 0 ? (
                      <>
                        <span>Images</span>
                        <span className="text-right">
                          {includeAddBreakdown.image.toLocaleString()}
                        </span>
                      </>
                    ) : null}
                    {includeAddBreakdown.audio > 0 ? (
                      <>
                        <span>Audio</span>
                        <span className="text-right">
                          {includeAddBreakdown.audio.toLocaleString()}
                        </span>
                      </>
                    ) : null}
                    {includeAddBreakdown.video > 0 ? (
                      <>
                        <span>Video</span>
                        <span className="text-right">
                          {includeAddBreakdown.video.toLocaleString()}
                        </span>
                      </>
                    ) : null}
                  </div>
                ) : null}
                <p className="text-sm text-muted-foreground">
                  Bigger folders take longer and tend to use more provider
                  quota.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ErrorMessage
            variant="callout"
            title="Error"
            message={addIncludeError}
          />
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={addIncludeLoading}
              className="h-auto min-h-9 px-3 py-2"
              aria-label="Cancel adding include folder"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={addIncludeLoading || includeToAdd === null}
              className="h-auto min-h-9 px-3 py-2"
              aria-label="Confirm add include folder"
              onClick={(e) => {
                e.preventDefault();
                confirmAddIncludeFolder();
              }}
            >
              {addIncludeLoading ? (
                <>
                  <Spinner className="h-4 w-4" aria-hidden="true" />
                  Confirming...
                </>
              ) : (
                "Confirm"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={confirmRemoveIncludeOpen}
        onOpenChange={onRemoveIncludeOpenChange}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">
              Remove this include folder and its vectors?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This removes the folder from your include paths and deletes
              indexed vectors for files in that folder. Your files on disk are
              not deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ErrorMessage
            variant="callout"
            title="Error"
            message={removeIncludeError}
          />
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={removeIncludeLoading}
              className="h-auto min-h-9 px-3 py-2"
              aria-label="Cancel removal"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={removeIncludeLoading || includeToRemove === null}
              className="h-auto min-h-9 px-3 py-2"
              aria-label="Remove folder and vectors"
              onClick={async (e) => {
                e.preventDefault();
                await removeIncludeFolderAndVectors();
              }}
            >
              {removeIncludeLoading ? (
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

      <AlertDialog
        open={confirmDisableDefaultExcludesOpen}
        onOpenChange={setConfirmDisableDefaultExcludesOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">
              Turn off automatic folder skipping?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Scanning and embedding may include many more files from
              dependencies, build outputs, and caches. Indexing will be slower
              and API usage costs can increase significantly.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-auto min-h-9 px-3 py-2">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="h-auto min-h-9 px-3 py-2"
              onClick={() => {
                updateConfig({ ...cfg, useDefaultFolderExcludes: false });
              }}
            >
              Turn off skipping
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
