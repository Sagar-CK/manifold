import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        "animate-[pulse_1.1s_cubic-bezier(0.4,0,0.6,1)_infinite] rounded-md bg-muted",
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
