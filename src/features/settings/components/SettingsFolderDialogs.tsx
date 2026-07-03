import { Fragment } from "react";
import { AppAlert } from "@/components/app/AppAlert";
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
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldDescription } from "@/components/ui/field";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import type { LocalConfig } from "@/lib/config/localConfig";

export type IncludeFolderBreakdown = {
  total: number;
  textLike: number;
  image: number;
  audio: number;
  video: number;
};

function FolderBreakdownRows({
  breakdown,
}: {
  breakdown: IncludeFolderBreakdown;
}) {
  const rows: Array<{ label: string; count: number }> = [];
  if (breakdown.textLike > 0) {
    rows.push({ label: "Text / PDF", count: breakdown.textLike });
  }
  if (breakdown.image > 0) {
    rows.push({ label: "Images", count: breakdown.image });
  }
  if (breakdown.audio > 0) {
    rows.push({ label: "Audio", count: breakdown.audio });
  }
  if (breakdown.video > 0) {
    rows.push({ label: "Video", count: breakdown.video });
  }

  if (rows.length === 0) return null;

  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-xs/relaxed text-muted-foreground">
      {rows.map((row) => (
        <Fragment key={row.label}>
          <dt>{row.label}</dt>
          <dd className="text-right tabular-nums">
            {row.count.toLocaleString()}
          </dd>
        </Fragment>
      ))}
    </dl>
  );
}

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
      <Dialog
        open={confirmAddIncludeOpen}
        onOpenChange={onAddIncludeOpenChange}
      >
        <DialogContent
          className="gap-4 p-5 sm:max-w-sm"
          showCloseButton={!addIncludeLoading}
        >
          <DialogHeader className="gap-1.5 pr-8">
            <DialogTitle>Add Folder</DialogTitle>
            {includeToAdd ? (
              <DialogDescription className="truncate text-xs/relaxed">
                {includeToAdd}
              </DialogDescription>
            ) : null}
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-4 text-sm">
                <span className="font-medium text-foreground">Files</span>
                <span className="tabular-nums text-muted-foreground">
                  {addIncludeLoading ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Spinner className="size-3.5" aria-hidden />
                      Counting files…
                    </span>
                  ) : includeAddBreakdown !== null ? (
                    includeAddBreakdown.total.toLocaleString()
                  ) : (
                    "0"
                  )}
                </span>
              </div>
              {!addIncludeLoading &&
              includeAddBreakdown !== null &&
              includeAddBreakdown.total > 0 ? (
                <>
                  <Separator />
                  <FolderBreakdownRows breakdown={includeAddBreakdown} />
                </>
              ) : null}
            </div>
            <FieldDescription>
              Bigger folders take longer and can use more provider quota.
            </FieldDescription>
          </div>

          <AppAlert variant="inline" message={addIncludeError} />

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={addIncludeLoading}
              onClick={() => onAddIncludeOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={addIncludeLoading || includeToAdd === null}
              onClick={confirmAddIncludeFolder}
            >
              Add Folder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={confirmRemoveIncludeOpen}
        onOpenChange={onRemoveIncludeOpenChange}
      >
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Stop Indexing This Folder?</AlertDialogTitle>
            <AlertDialogDescription>
              Manifold will stop searching files in this folder and remove its
              existing search data from the index. The folder and files on disk
              will stay where they are.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AppAlert variant="inline" message={removeIncludeError} />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removeIncludeLoading}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={removeIncludeLoading || includeToRemove === null}
              onClick={async (e) => {
                e.preventDefault();
                await removeIncludeFolderAndVectors();
              }}
            >
              {removeIncludeLoading ? (
                <>
                  <Spinner data-icon="inline-start" aria-hidden />
                  Removing…
                </>
              ) : (
                "Stop Indexing"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={confirmDisableDefaultExcludesOpen}
        onOpenChange={setConfirmDisableDefaultExcludesOpen}
      >
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Turn Off Automatic Folder Skipping?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Scanning and indexing may include many more files from
              dependencies, build outputs, and caches. Indexing will be slower
              and API usage costs can increase significantly.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                updateConfig({ ...cfg, useDefaultFolderExcludes: false });
              }}
            >
              Turn Off Skipping
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
