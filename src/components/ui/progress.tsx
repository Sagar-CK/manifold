import * as React from "react";

import { cn } from "../../lib/utils";

export type ProgressProps = React.HTMLAttributes<HTMLDivElement> & {
  value?: number;
};

export function Progress({ className, value = 0, ...props }: ProgressProps) {
  const safeValue = Math.max(0, Math.min(100, value));

  return (
    <div
      className={cn("relative h-2 w-full overflow-hidden rounded-full bg-black/10", className)}
      {...props}
    >
      <div
        className="h-full bg-black transition-all"
        style={{ width: `${safeValue}%` }}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={safeValue}
        role="progressbar"
      />
    </div>
  );
}
