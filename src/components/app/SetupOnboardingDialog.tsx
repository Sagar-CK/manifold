import { CheckmarkCircle02Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { type ReactNode, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { HugeIcon } from "@/components/ui/huge-icon";
import { Spinner } from "@/components/ui/spinner";
import { useAppHealthContext } from "@/context/AppHealthContext";
import { openExternalUrl } from "@/lib/api/desktop";
import { invokeErrorText } from "@/lib/errors";
import { cn } from "@/lib/utils";

const DOCKER_DESKTOP_URL = "https://www.docker.com/products/docker-desktop/";
const ONBOARDING_COMPLETED_KEY = "manifold.setupOnboardingCompleted";

type StepState = "pending" | "loading" | "complete";
type SettingsSection = "general" | "folders";

function SetupStepIndicator({
  state,
  index,
}: {
  state: StepState;
  index: number;
}) {
  if (state === "complete") {
    return (
      <div
        className="flex size-7 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
        aria-hidden
      >
        <HugeIcon icon={Tick02Icon} className="size-3.5" />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-muted/30 text-xs font-medium tabular-nums text-muted-foreground",
        state === "loading" && "border-primary/30 bg-primary/10 text-primary",
      )}
      aria-hidden
    >
      {index}
    </div>
  );
}

function SetupStepRow({
  index,
  title,
  description,
  state,
  children,
}: {
  index: number;
  title: string;
  description: string;
  state: StepState;
  children?: ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <SetupStepIndicator state={state} index={index} />
      <div className="flex min-w-0 flex-1 flex-col gap-2 pt-0.5">
        <div className="flex flex-col gap-0.5">
          <p
            className={cn(
              "text-sm font-medium leading-snug",
              state === "complete" && "text-muted-foreground",
            )}
          >
            {title}
          </p>
          <p className="text-xs/relaxed text-muted-foreground">{description}</p>
        </div>
        {state !== "complete" ? children : null}
      </div>
    </div>
  );
}

export function SetupOnboardingDialog({
  includeFolderCount,
}: {
  includeFolderCount: number;
}) {
  const navigate = useNavigate();
  const { envIssues, refreshHealth, startQdrantDockerContainer } =
    useAppHealthContext();
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [completedOnce, setCompletedOnce] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(ONBOARDING_COMPLETED_KEY) === "true";
  });
  const [loadingStep, setLoadingStep] = useState<
    "qdrant" | "gemini" | "folders" | null
  >(null);

  const qdrantIssue = envIssues.find(
    (issue) => issue.id === "qdrant-unreachable",
  );
  const geminiIssue = envIssues.find((issue) => issue.id === "gemini-missing");

  const qdrantComplete = !qdrantIssue;
  const geminiComplete = !geminiIssue;
  const foldersComplete = includeFolderCount > 0;
  const setupComplete = qdrantComplete && geminiComplete && foldersComplete;
  const shouldAutoOpen = !completedOnce && !setupComplete;

  const qdrantState: StepState =
    loadingStep === "qdrant"
      ? "loading"
      : qdrantComplete
        ? "complete"
        : "pending";
  const geminiState: StepState = geminiComplete ? "complete" : "pending";
  const foldersState: StepState = foldersComplete ? "complete" : "pending";

  useEffect(() => {
    if (setupComplete) {
      if (!completedOnce) {
        window.localStorage.setItem(ONBOARDING_COMPLETED_KEY, "true");
        setCompletedOnce(true);
      }
      setDismissed(false);
      setOpen(false);
      setLoadingStep(null);
      return;
    }
    if (shouldAutoOpen && !dismissed) {
      setOpen(true);
    }
  }, [setupComplete, completedOnce, shouldAutoOpen, dismissed]);

  useEffect(() => {
    if (open) {
      void refreshHealth();
    }
  }, [open, includeFolderCount, refreshHealth]);

  async function handleStartQdrant() {
    setLoadingStep("qdrant");
    try {
      await startQdrantDockerContainer();
      toast.success("Qdrant is ready", {
        description: "Search and indexing are available.",
      });
    } catch (error) {
      toast.error("Could not start Qdrant", {
        description: invokeErrorText(error),
      });
      await refreshHealth();
    } finally {
      setLoadingStep(null);
    }
  }

  function openSettings(section: SettingsSection) {
    setDismissed(true);
    setOpen(false);
    navigate(`/settings#${section}`);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next && !setupComplete) {
          setDismissed(true);
        }
      }}
    >
      <DialogContent className="sm:max-w-md" showCloseButton>
        <DialogHeader>
          <DialogTitle>Set up Manifold</DialogTitle>
          <DialogDescription>
            Complete these steps to search and index files on your machine.
          </DialogDescription>
        </DialogHeader>

        {setupComplete ? (
          <div className="flex items-start gap-3 rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-3 py-3">
            <HugeIcon
              icon={CheckmarkCircle02Icon}
              className="mt-0.5 size-5 shrink-0 text-emerald-600 dark:text-emerald-400"
              aria-hidden
            />
            <div className="flex flex-col gap-0.5">
              <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
                You&apos;re all set
              </p>
              <p className="text-xs/relaxed text-muted-foreground">
                Manifold can index and search your files.
              </p>
            </div>
          </div>
        ) : (
          <ol className="flex flex-col gap-5">
            <li>
              <SetupStepRow
                index={1}
                title="Start Qdrant"
                description={
                  qdrantIssue?.message ??
                  "Local vector database for semantic search."
                }
                state={qdrantState}
              >
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={loadingStep === "qdrant"}
                    onClick={() => void handleStartQdrant()}
                  >
                    {loadingStep === "qdrant" ? (
                      <>
                        <Spinner data-icon="inline-start" />
                        Setting up…
                      </>
                    ) : (
                      "Set up Qdrant"
                    )}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="text-muted-foreground"
                    disabled={loadingStep === "qdrant"}
                    onClick={() => void openExternalUrl(DOCKER_DESKTOP_URL)}
                  >
                    Get Docker Desktop
                  </Button>
                </div>
              </SetupStepRow>
            </li>

            <li>
              <SetupStepRow
                index={2}
                title="Add Gemini API Key"
                description={
                  geminiIssue?.message ??
                  "Paste your Google AI key in Settings."
                }
                state={geminiState}
              >
                <Button
                  type="button"
                  size="sm"
                  onClick={() => openSettings("general")}
                >
                  Open Settings
                </Button>
              </SetupStepRow>
            </li>

            <li>
              <SetupStepRow
                index={3}
                title="Choose Folders to Index"
                description="Add at least one include folder under Folders."
                state={foldersState}
              >
                <Button
                  type="button"
                  size="sm"
                  onClick={() => openSettings("folders")}
                >
                  Open Settings
                </Button>
              </SetupStepRow>
            </li>
          </ol>
        )}
      </DialogContent>
    </Dialog>
  );
}
