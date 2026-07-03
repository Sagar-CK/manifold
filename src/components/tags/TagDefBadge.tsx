import type { TagDef } from "@/lib/tags";
import {
  TagPill,
  tagPillActiveData,
  tagPillClassName,
  tagPillDotClassName,
  tagPillStyleFor,
} from "./TagPill";

/** Same tint + ring as {@link TagDefBadge}, for menus and inline labels (no remove control). */
export function TagDefLabel({
  tag,
  className,
}: {
  tag: TagDef;
  className?: string;
}) {
  return <TagPill tag={tag} className={className} />;
}

export function TagDefBadge({
  tag,
  onSelect,
  selected,
  className,
}: {
  tag: TagDef;
  onSelect?: () => void;
  selected?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      data-active={tagPillActiveData(true)}
      style={tagPillStyleFor(tag)}
      className={tagPillClassName(
        "w-fit max-w-xs",
        selected && "ring-2 ring-ring/35",
        className,
      )}
      onClick={() => onSelect?.()}
      aria-pressed={selected}
    >
      <span className={tagPillDotClassName} aria-hidden="true" />
      <span className="min-w-0 truncate">{tag.name}</span>
    </button>
  );
}
