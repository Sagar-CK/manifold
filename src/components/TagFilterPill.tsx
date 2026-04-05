import { Toggle } from "@/components/ui/toggle";
import { cn } from "@/lib/utils";
import type { TagDef } from "@/lib/tags";

type TagFilterPillProps = {
  tag: Pick<TagDef, "id" | "name" | "color">;
  pressed: boolean;
  onPressedChange: (next: boolean) => void;
  ariaLabel: string;
};

export function TagFilterPill({ tag, pressed, onPressedChange, ariaLabel }: TagFilterPillProps) {
  return (
    <Toggle
      variant="outline"
      pressed={pressed}
      onPressedChange={onPressedChange}
      aria-label={ariaLabel}
      className={cn(
        "h-auto min-h-0 shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium shadow-none hover:bg-muted/80",
        pressed && "shadow-none",
      )}
      style={
        pressed
          ? {
              backgroundColor: `${tag.color}20`,
              borderColor: tag.color,
            }
          : undefined
      }
    >
      {tag.name}
    </Toggle>
  );
}
