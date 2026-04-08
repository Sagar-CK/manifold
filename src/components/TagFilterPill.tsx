import { Toggle } from "@/components/ui/toggle";
import type { TagDef } from "@/lib/tags";
import { cn } from "@/lib/utils";

type TagFilterPillProps = {
  tag: Pick<TagDef, "id" | "name" | "color">;
  pressed: boolean;
  onPressedChange: (next: boolean) => void;
  ariaLabel: string;
};

export function TagFilterPill({
  tag,
  pressed,
  onPressedChange,
  ariaLabel,
}: TagFilterPillProps) {
  return (
    <Toggle
      variant="outline"
      pressed={pressed}
      onPressedChange={onPressedChange}
      aria-label={ariaLabel}
      className={cn(
        "h-auto min-h-0 shrink-0 rounded-full border-border/70 bg-background px-2.5 py-1 text-xs font-normal text-foreground shadow-none hover:bg-muted/50 aria-pressed:border-border aria-pressed:bg-muted aria-pressed:text-foreground",
        pressed && "shadow-none",
      )}
    >
      <span
        className="size-1.5 rounded-full"
        style={{ backgroundColor: tag.color }}
        aria-hidden="true"
      />
      {tag.name}
    </Toggle>
  );
}
