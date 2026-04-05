import { useMemo, type ReactNode } from "react";
import { CircleHelp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";

function modKeyLabel() {
  if (typeof navigator === "undefined") return "Ctrl";
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform) ? "⌘" : "Ctrl";
}

function ShortcutLine({ shortcut, explanation }: { shortcut: ReactNode; explanation: string }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="min-w-0 flex-1 leading-snug text-foreground">{explanation}</span>
      <div
        className={cn(
          "mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-md border border-border/60 bg-muted/60 px-2 py-1",
          "[&_kbd[data-slot=kbd]]:bg-transparent"
        )}
      >
        {shortcut}
      </div>
    </div>
  );
}

export function KeyboardShortcutsHelp() {
  const mod = useMemo(() => modKeyLabel(), []);

  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-40">
      <div className="pointer-events-auto">
        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-11 w-11 rounded-full border-black/15 bg-white/90 shadow-md backdrop-blur-sm hover:bg-white"
              aria-label="Keyboard shortcuts"
            >
              <CircleHelp className="h-5 w-5 text-black/70" aria-hidden />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            side="top"
            align="end"
            sideOffset={8}
            className="w-[min(100vw-2rem,22rem)] gap-3 p-4"
          >
            <PopoverHeader className="gap-0">
              <PopoverTitle>Shortcuts</PopoverTitle>
            </PopoverHeader>
            <div className="flex flex-col gap-2.5">
              <ShortcutLine
                shortcut={
                  <KbdGroup>
                    <Kbd>{mod}</Kbd>
                    <span className="text-muted-foreground" aria-hidden>
                      +
                    </span>
                    <Kbd>Click</Kbd>
                  </KbdGroup>
                }
                explanation="Open file in default app"
              />
              <ShortcutLine shortcut={<Kbd>Esc</Kbd>} explanation="Close dialog" />
              <ShortcutLine shortcut={<Kbd>Double-click</Kbd>} explanation="Open file detail" />
              <ShortcutLine shortcut={<Kbd>Scroll wheel</Kbd>} explanation="Zoom" />
              <ShortcutLine shortcut={<Kbd>Drag</Kbd>} explanation="Pan" />
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
