import type { IconSvgElement } from "@hugeicons/react";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

type HugeIconProps = Omit<ComponentProps<typeof HugeiconsIcon>, "icon"> & {
  icon: IconSvgElement;
};

/**
 * Renders a Hugeicons stroke icon with Tailwind-friendly defaults.
 */
export function HugeIcon({
  icon,
  className,
  size = 16,
  strokeWidth = 1.5,
  color = "currentColor",
  ...props
}: HugeIconProps) {
  return (
    <HugeiconsIcon
      icon={icon}
      size={size}
      strokeWidth={strokeWidth}
      color={color}
      className={cn("shrink-0", className)}
      {...props}
    />
  );
}
