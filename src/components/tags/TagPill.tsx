import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import type { TagDef } from "@/lib/tags";
import { tagPillStyle } from "@/lib/tags/pillStyle";
import { cn } from "@/lib/utils";

type TagPillTag = Pick<TagDef, "name" | "color">;

const tagPillBaseClassName =
  "tag-pill inline-flex min-h-5 w-fit max-w-xs min-w-0 shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-full border px-2 py-0.5 text-[11px]/[1.25] font-normal whitespace-nowrap text-foreground shadow-none transition-colors";

const tagPillDotClassName = "tag-pill-dot size-1.5 shrink-0 rounded-full";
const tagPillInactiveStyle = {
  "--tag-color": "var(--muted-foreground)",
  "--tag-dot-color": "var(--muted-foreground)",
  background: "color-mix(in srgb, var(--muted-foreground) 16%, var(--muted))",
  borderColor: "color-mix(in srgb, var(--muted-foreground) 28%, transparent)",
  color: "var(--muted-foreground)",
} as CSSProperties;

function tagPillClassName(...className: Parameters<typeof cn>) {
  return cn(tagPillBaseClassName, ...className);
}

function tagPillStyleFor(
  tag: TagPillTag,
  active = true,
  style?: CSSProperties,
): CSSProperties | undefined {
  const stateStyle = active
    ? ({
        ...tagPillStyle(tag.color),
        "--tag-dot-color": tag.color,
        background: `color-mix(in srgb, ${tag.color} 34%, transparent)`,
        borderColor: `color-mix(in srgb, ${tag.color} 48%, transparent)`,
        color: "var(--foreground)",
      } as CSSProperties)
    : tagPillInactiveStyle;
  return { ...stateStyle, ...style };
}

function tagPillActiveData(active = true) {
  return active ? "true" : undefined;
}

function TagPill({
  tag,
  active = true,
  showDot = true,
  className,
  children,
  style,
  ...props
}: Omit<HTMLAttributes<HTMLSpanElement>, "children"> & {
  tag: TagPillTag;
  active?: boolean;
  showDot?: boolean;
  children?: ReactNode;
}) {
  return (
    <span
      data-active={tagPillActiveData(active)}
      style={tagPillStyleFor(tag, active, style)}
      className={tagPillClassName(className)}
      {...props}
    >
      {showDot ? <span className={tagPillDotClassName} aria-hidden /> : null}
      <span className="min-w-0 truncate">{children ?? tag.name}</span>
    </span>
  );
}

export {
  TagPill,
  tagPillActiveData,
  tagPillClassName,
  tagPillDotClassName,
  tagPillStyleFor,
};
