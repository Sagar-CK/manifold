import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { TagDef } from "@/lib/tags";
import { cn } from "@/lib/utils";

const tagDefBadgeSurfaceClassName =
  "border-border/70 bg-background text-foreground shadow-none";

/** Same tint + ring as {@link TagDefBadge}, for menus and inline labels (no remove control). */
export function TagDefLabel({
  tag,
  className,
}: {
  tag: TagDef;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "inline-flex w-fit max-w-xs min-w-0 gap-1.5",
        tagDefBadgeSurfaceClassName,
        className,
      )}
    >
      <span
        className="size-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: tag.color }}
        aria-hidden="true"
      />
      <span className="min-w-0 truncate">{tag.name}</span>
    </Badge>
  );
}

/**
 * Same structure as Badge “With icon” (text + `data-icon="inline-end"`); `asChild` + div
 * wraps a real button for a11y. Custom tint follows Badge “Custom colors”.
 */
export function TagDefBadge({
  tag,
  onRemove,
  className,
}: {
  tag: TagDef;
  onRemove: () => void;
  className?: string;
}) {
  return (
    <Badge
      asChild
      variant="outline"
      className={cn(
        "w-fit max-w-xs min-w-0",
        tagDefBadgeSurfaceClassName,
        className,
      )}
    >
      <div>
        <span
          className="size-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: tag.color }}
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1 truncate">{tag.name}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="size-5 shrink-0 rounded-full p-0 text-muted-foreground hover:text-foreground"
          aria-label={`Remove tag ${tag.name}`}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRemove();
          }}
        >
          <X data-icon="inline-end" className="size-3" aria-hidden="true" />
        </Button>
      </div>
    </Badge>
  );
}
