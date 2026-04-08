import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

export type ErrorMessageVariant = "compact" | "inline" | "callout" | "centered";

type ErrorMessageProps = {
  message: string | null | undefined;
  variant?: ErrorMessageVariant;
  /** Shown above the message for callout/centered when set. */
  title?: string;
  className?: string;
};

export function ErrorMessage({
  message,
  variant = "inline",
  title,
  className,
}: ErrorMessageProps) {
  const text = typeof message === "string" ? message.trim() : "";
  if (!text) return null;

  if (variant === "compact") {
    return (
      <Alert
        className={cn(
          "max-h-32 gap-0 rounded-lg border-border/70 bg-muted/20 px-3 py-2",
          className,
        )}
      >
        <AlertDescription className="overflow-y-auto whitespace-pre-wrap break-words text-left font-mono text-[11px] font-normal leading-snug text-muted-foreground">
          {text}
        </AlertDescription>
      </Alert>
    );
  }

  if (variant === "inline") {
    return (
      <p
        className={cn("text-left text-sm text-muted-foreground", className)}
        role="alert"
      >
        {text}
      </p>
    );
  }

  if (variant === "callout") {
    return (
      <Alert
        className={cn("rounded-xl border-border/70 bg-muted/15", className)}
      >
        {title ? <AlertTitle>{title}</AlertTitle> : null}
        <AlertDescription className={title ? "mt-0.5" : ""}>
          {text}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert
      className={cn(
        "mx-auto max-w-md justify-items-center rounded-xl border-border/70 bg-muted/15 px-5 py-4 text-center",
        className,
      )}
    >
      {title ? <AlertTitle className="text-center">{title}</AlertTitle> : null}
      <AlertDescription className={cn("text-center", title ? "mt-0.5" : "")}>
        {text}
      </AlertDescription>
    </Alert>
  );
}
