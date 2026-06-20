import { Loading03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

function Spinner({
  className,
  ...props
}: Omit<ComponentProps<typeof HugeiconsIcon>, "icon">) {
  return (
    <HugeiconsIcon
      icon={Loading03Icon}
      role="status"
      aria-label="Loading"
      size={16}
      strokeWidth={1.5}
      color="currentColor"
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  );
}

export { Spinner };
