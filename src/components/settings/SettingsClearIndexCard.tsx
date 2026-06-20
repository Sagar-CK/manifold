import { Delete02Icon } from "@hugeicons/core-free-icons";
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@/components/ui/field";
import { HugeIcon } from "@/components/ui/huge-icon";
import { Spinner } from "@/components/ui/spinner";

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
    <Field className="rounded-lg border border-destructive/20 bg-destructive/5 p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <FieldLabel>Clear index</FieldLabel>
          <FieldDescription>
            Remove all {liveIndexedCount ?? "—"} indexed embeddings. Files on
            disk are not affected.
          </FieldDescription>
          <AppAlert variant="inline" message={clearIndexError} />
        </div>

        <AlertDialog open={confirmClearOpen} onOpenChange={setConfirmClearOpen}>
          <AlertDialogTrigger asChild>
            <Button
              variant="destructive"
              size="sm"
              className="shrink-0"
              disabled={clearingIndex || liveIndexedCount === 0}
            >
              {clearingIndex ? (
                <Spinner data-icon="inline-start" aria-hidden="true" />
              ) : (
                <HugeIcon icon={Delete02Icon} data-icon="inline-start" aria-hidden />
              )}
              Clear index
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Delete all {liveIndexedCount} vectors?
              </AlertDialogTitle>
              <AlertDialogDescription>
                Clears all indexed vectors for this profile. Files are not
                deleted.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={clearingIndex}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={clearingIndex}
                onClick={async (e) => {
                  e.preventDefault();
                  await deleteAllVectors();
                }}
              >
                {clearingIndex ? (
                  <>
                    <Spinner data-icon="inline-start" aria-hidden="true" />
                    Deleting…
                  </>
                ) : (
                  "Delete"
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </Field>
  );
}
