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
      <div
        className={cn(
          "max-h-32 w-full overflow-y-auto whitespace-pre-wrap break-words text-left font-mono text-[11px] font-normal leading-snug text-rose-950/85",
          className,
        )}
        role="alert"
      >
        {text}
      </div>
    );
  }

  if (variant === "inline") {
    return (
      <p className={cn("text-left text-sm font-medium text-destructive", className)} role="alert">
        {text}
      </p>
    );
  }

  if (variant === "callout") {
    return (
      <div
        className={cn(
          "rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700",
          className,
        )}
        role="alert"
      >
        {title ? <div className="font-medium">{title}</div> : null}
        <div className={title ? "mt-1" : ""}>{text}</div>
      </div>
    );
  }

  // centered
  return (
    <div className={cn("text-center", className)} role="alert">
      {title ? <div className="text-sm font-medium text-rose-800">{title}</div> : null}
      <div
        className={cn(
          "text-sm text-rose-800/95",
          title ? "mt-1" : "",
        )}
      >
        {text}
      </div>
    </div>
  );
}
