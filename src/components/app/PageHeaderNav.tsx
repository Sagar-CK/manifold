import {
  ChartScatterIcon,
  Settings01Icon,
  TaskDone01Icon,
} from "@hugeicons/core-free-icons";
import { Link, useLocation } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HugeIcon } from "@/components/ui/huge-icon";
import { useTagsState } from "@/lib/tags/useTagsState";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  {
    to: "/review-tags",
    label: "Tags",
    shortLabel: "Tags",
    icon: TaskDone01Icon,
  },
  {
    to: "/graph",
    label: "File Visualizer",
    shortLabel: "Visualizer",
    icon: ChartScatterIcon,
  },
  {
    to: "/settings",
    label: "Settings",
    shortLabel: "Settings",
    icon: Settings01Icon,
  },
] as const;

export function PageHeaderNav() {
  const { pathname } = useLocation();
  const [tagsState] = useTagsState();
  const pendingReviewCount = Object.values(tagsState.pendingAutoTags).reduce(
    (total, ids) => total + (ids?.length ?? 0),
    0,
  );

  return (
    <nav
      className="absolute right-0 top-0 flex items-center gap-1"
      aria-label="Page Navigation"
    >
      {NAV_ITEMS.map((item) => {
        const active = pathname === item.to;
        const isReview = item.to === "/review-tags";
        const label =
          isReview && pendingReviewCount > 0
            ? `Review ${pendingReviewCount} Suggested Tag${
                pendingReviewCount === 1 ? "" : "s"
              }`
            : item.label;

        return (
          <Button
            key={item.to}
            variant="ghost"
            size="sm"
            className={cn(
              "relative h-7 rounded-full px-2 text-muted-foreground hover:bg-muted/50",
              active && "bg-muted/50 text-foreground",
            )}
            asChild
          >
            <Link
              to={item.to}
              aria-label={label}
              aria-current={active ? "page" : undefined}
            >
              <HugeIcon
                icon={item.icon}
                data-icon="inline-start"
                className="size-3.5"
                aria-hidden
              />
              <span className="text-[11px] font-medium">{item.shortLabel}</span>
              {isReview && pendingReviewCount > 0 ? (
                <Badge
                  variant="outline"
                  className={cn(
                    "absolute right-0 top-0 flex min-h-4 translate-x-1/3 -translate-y-1/3 items-center justify-center rounded-full border-background bg-red-500 p-0 text-[9px] font-semibold leading-none text-white shadow-xs tabular-nums",
                    pendingReviewCount > 99
                      ? "h-4 min-w-6 px-1"
                      : "size-4 min-w-4",
                  )}
                >
                  {pendingReviewCount > 99 ? "99+" : pendingReviewCount}
                </Badge>
              ) : null}
            </Link>
          </Button>
        );
      })}
    </nav>
  );
}
