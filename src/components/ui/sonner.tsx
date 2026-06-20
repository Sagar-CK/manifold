import {
  Alert02Icon,
  CancelCircleIcon,
  CheckmarkCircle02Icon,
  InformationCircleIcon,
  Loading03Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";

const iconProps = {
  size: 16,
  strokeWidth: 1.5,
  color: "currentColor" as const,
};

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: (
          <HugeiconsIcon
            icon={CheckmarkCircle02Icon}
            className="size-4"
            {...iconProps}
          />
        ),
        info: (
          <HugeiconsIcon
            icon={InformationCircleIcon}
            className="size-4"
            {...iconProps}
          />
        ),
        warning: (
          <HugeiconsIcon icon={Alert02Icon} className="size-4" {...iconProps} />
        ),
        error: (
          <HugeiconsIcon
            icon={CancelCircleIcon}
            className="size-4"
            {...iconProps}
          />
        ),
        loading: (
          <HugeiconsIcon
            icon={Loading03Icon}
            className="size-4 animate-spin"
            {...iconProps}
          />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast:
            "group toast !items-start gap-3 group-[.toaster]:rounded-xl group-[.toaster]:border group-[.toaster]:border-border/70 group-[.toaster]:bg-popover group-[.toaster]:text-popover-foreground group-[.toaster]:shadow-xs",
          title: "text-sm font-medium leading-snug",
          description: "text-xs/relaxed text-muted-foreground",
          actionButton:
            "group-[.toast]:!h-7 group-[.toast]:!rounded-md group-[.toast]:!px-2.5 group-[.toast]:!text-xs group-[.toast]:!font-medium group-[.toast]:!bg-primary group-[.toast]:!text-primary-foreground",
          cancelButton:
            "group-[.toast]:!h-7 group-[.toast]:!rounded-md group-[.toast]:!px-2.5 group-[.toast]:!text-xs group-[.toast]:!font-medium group-[.toast]:!bg-muted group-[.toast]:!text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
