import { Moon01Icon, Sun01Icon } from "@hugeicons/core-free-icons";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { HugeIcon } from "@/components/ui/huge-icon";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function ThemeToggle() {
  const { setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = resolvedTheme === "dark";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-9 shrink-0 text-muted-foreground"
          disabled={!mounted}
          aria-label={isDark ? "Use light theme" : "Use dark theme"}
          onClick={() => setTheme(isDark ? "light" : "dark")}
        >
          {mounted && isDark ? (
            <HugeIcon icon={Sun01Icon} className="h-4 w-4" aria-hidden />
          ) : (
            <HugeIcon icon={Moon01Icon} className="h-4 w-4" aria-hidden />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {isDark ? "Light theme" : "Dark theme"}
      </TooltipContent>
    </Tooltip>
  );
}
