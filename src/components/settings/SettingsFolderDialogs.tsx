import { Fragment } from "react";
import { AppAlert } from "@/components/AppAlert";
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
import { Spinner } from "@/components/ui/spinner";
import type { LocalConfig } from "@/lib/localConfig";

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
    <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-xs/relaxed text-muted-foreground">
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
      <Dialog open={confirmAddIncludeOpen} onOpenChange={onAddIncludeOpenChange}>
        <DialogContent className="sm:max-w-md" showCloseButton={!addIncludeLoading}>
          <DialogHeader>
            <DialogTitle>Add folder</DialogTitle>
            {includeToAdd ? (
              <DialogDescription className="truncate font-mono">
                {includeToAdd}
              </DialogDescription>
            ) : null}
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2.5">
              <p className="text-sm font-medium tabular-nums text-foreground">
                {addIncludeLoading
                  ? "Counting files…"
                  : includeAddBreakdown !== null
                    ? `${includeAddBreakdown.total.toLocaleString()} file${includeAddBreakdown.total === 1 ? "" : "s"}`
                    : "—"}
              </p>
              {!addIncludeLoading &&
              includeAddBreakdown !== null &&
              includeAddBreakdown.total > 0 ? (
                <div className="mt-2 border-t border-border/60 pt-2">
                  <FolderBreakdownRows breakdown={includeAddBreakdown} />
                </div>
              ) : null}
            </div>
            <FieldDescription>
              Bigger folders take longer and tend to use more provider quota.
            </FieldDescription>
          </div>

          <AppAlert variant="inline" message={addIncludeError} />

          <DialogFooter>
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
              {addIncludeLoading ? (
                <>
                  <Spinner data-icon="inline-start" aria-hidden />
                  Confirming…
                </>
              ) : (
                "Add folder"
              )}
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
            <AlertDialogTitle>
              Remove this include folder and its vectors?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This removes the folder from your include paths and deletes
              indexed vectors for files in that folder. Your files on disk are
              not deleted.
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
                  Deleting…
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
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Turn off automatic folder skipping?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Scanning and embedding may include many more files from
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
              Turn off skipping
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
