import { AlertCircleIcon } from "@hugeicons/core-free-icons";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { HugeIcon } from "@/components/ui/huge-icon";
import { normalizeAlertMessage } from "@/lib/setupErrors";
import { cn } from "@/lib/utils";

type AppAlertVariant = "inline" | "banner" | "compact" | "centered" | "callout";

type AppAlertProps = {
  message: string | null | undefined;
  title?: string;
  variant?: AppAlertVariant;
  className?: string;
};

export function AppAlert({
  message,
  title,
  variant = "banner",
  className,
}: AppAlertProps) {
  const text =
    typeof message === "string" ? normalizeAlertMessage(message) : "";
  if (!text) return null;

  if (variant === "inline") {
    return (
      <p
        className={cn("text-left text-sm text-destructive", className)}
        role="alert"
      >
        {text}
      </p>
    );
  }

  const centered = variant === "centered";

  return (
    <Alert
      variant="destructive"
      className={cn(
        "rounded-lg border px-3 py-2.5",
        variant === "compact" ? "gap-1" : "gap-1.5",
        centered && "mx-auto max-w-md text-center",
        className,
      )}
    >
      <HugeIcon
        icon={AlertCircleIcon}
        className={cn(centered && "mx-auto")}
        aria-hidden
      />
      {title ? (
        <AlertTitle className={cn("text-sm", centered && "text-center")}>
          {title}
        </AlertTitle>
      ) : null}
      <AlertDescription
        className={cn(
          "whitespace-pre-wrap break-words text-xs/relaxed",
          "col-start-2",
          centered && "text-center",
        )}
      >
        {text}
      </AlertDescription>
    </Alert>
  );
}
