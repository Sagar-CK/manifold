import * as React from "react";

import { cn } from "../../lib/utils";

export type ProgressProps = React.HTMLAttributes<HTMLDivElement> & {
  value?: number;
  trackClassName?: string;
  indicatorClassName?: string;
};

export function Progress({
  className,
  value = 0,
  trackClassName,
  indicatorClassName,
  ...props
}: ProgressProps) {
  const safeValue = Math.max(0, Math.min(100, value));

  return (
    <div
      className={cn("relative h-2 w-full overflow-hidden rounded-full bg-muted", trackClassName, className)}
      {...props}
    >
      <div
        className={cn("h-full bg-primary transition-all", indicatorClassName)}
        style={{ width: `${safeValue}%` }}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={safeValue}
        role="progressbar"
      />
    </div>
  );
}
