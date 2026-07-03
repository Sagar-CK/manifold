import { Toggle } from "@/components/ui/toggle";
import type { TagDef } from "@/lib/tags";
import {
  tagPillActiveData,
  tagPillClassName,
  tagPillDotClassName,
  tagPillStyleFor,
} from "./TagPill";

type TagFilterPillProps = {
  tag: Pick<TagDef, "id" | "name" | "color">;
  pressed: boolean;
  onPressedChange: (next: boolean) => void;
  ariaLabel: string;
  className?: string;
};

export function TagFilterPill({
  tag,
  pressed,
  onPressedChange,
  ariaLabel,
  className,
}: TagFilterPillProps) {
  return (
    <Toggle
      variant="outline"
      pressed={pressed}
      onPressedChange={onPressedChange}
      aria-label={ariaLabel}
      data-active={tagPillActiveData(pressed)}
      style={tagPillStyleFor(tag, pressed)}
      className={tagPillClassName(
        "h-auto min-h-5 min-w-0 focus-visible:ring-2 focus-visible:ring-ring/50",
        className,
      )}
    >
      <span className={tagPillDotClassName} aria-hidden="true" />
      <span className="min-w-0 truncate">{tag.name}</span>
    </Toggle>
  );
}
