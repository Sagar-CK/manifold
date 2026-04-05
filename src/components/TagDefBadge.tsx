import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { TagDef } from "@/lib/tags";

const tagDefBadgeSurfaceClassName =
  "border-transparent text-foreground shadow-none ring-1 ring-inset ring-foreground/10 dark:ring-foreground/15";

/** Same tint + ring as {@link TagDefBadge}, for menus and inline labels (no remove control). */
export function TagDefLabel({ tag, className }: { tag: TagDef; className?: string }) {
  return (
    <Badge
      variant="secondary"
      className={cn(
        "inline-flex w-fit max-w-xs min-w-0",
        tagDefBadgeSurfaceClassName,
        className,
      )}
      style={{ backgroundColor: `${tag.color}38` }}
    >
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
      variant="secondary"
      className={cn("w-fit max-w-xs min-w-0", tagDefBadgeSurfaceClassName, className)}
      style={{
        backgroundColor: `${tag.color}38`,
      }}
    >
      <div>
        <span className="min-w-0 flex-1 truncate">{tag.name}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="size-5 shrink-0 rounded-full p-0 text-foreground/45 hover:text-foreground/90"
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
