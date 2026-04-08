import { ChartScatter, ListChecks, Settings } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function SearchPageHeaderActions({
  pendingReviewCount,
}: {
  pendingReviewCount: number;
}) {
  return (
    <div className="absolute right-0 top-0 flex items-center gap-0.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="relative rounded-full text-muted-foreground hover:bg-muted/50"
            asChild
          >
            <Link
              to="/review-tags"
              aria-label={
                pendingReviewCount > 0
                  ? `Review ${pendingReviewCount} suggested tag${pendingReviewCount === 1 ? "" : "s"}`
                  : "Review suggested tags"
              }
            >
              <ListChecks className="h-5 w-5" aria-hidden="true" />
              {pendingReviewCount > 0 ? (
                <Badge
                  variant="outline"
                  className="absolute -right-1 -top-1 h-[18px] min-w-[18px] justify-center rounded-full border-border/70 bg-card px-1 text-[10px] font-medium leading-none text-foreground shadow-xs"
                >
                  {pendingReviewCount > 99 ? "99+" : pendingReviewCount}
                </Badge>
              ) : null}
            </Link>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Review suggested tags</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full text-muted-foreground hover:bg-muted/50"
            asChild
          >
            <Link to="/graph" aria-label="Open graph explorer">
              <ChartScatter className="h-5 w-5" aria-hidden="true" />
            </Link>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Graph explorer</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full text-muted-foreground hover:bg-muted/50"
            asChild
          >
            <Link to="/settings" aria-label="Open settings">
              <Settings className="h-5 w-5" aria-hidden="true" />
            </Link>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Settings</TooltipContent>
      </Tooltip>
    </div>
  );
}
