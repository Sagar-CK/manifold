import { ChartScatter, ListChecks, Settings } from "lucide-react";
import { Link } from "react-router-dom";
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
            className="relative text-muted-foreground"
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
                <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-orange-500 px-1 text-[10px] font-semibold leading-none text-white">
                  {pendingReviewCount > 99 ? "99+" : pendingReviewCount}
                </span>
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
            className="text-muted-foreground"
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
            className="text-muted-foreground"
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
