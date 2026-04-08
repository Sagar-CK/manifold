import { CircleHelp } from "lucide-react";
import { Fragment, type ReactNode, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  CONTEXT_SHORTCUTS,
  GLOBAL_SHORTCUTS,
  type ShortcutDefinition,
} from "@/lib/appShortcuts";
import { cn } from "@/lib/utils";

function modKeyLabel() {
  if (typeof navigator === "undefined") return "Ctrl";
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform) ? "⌘" : "Ctrl";
}

function ShortcutLine({
  shortcut,
  explanation,
}: {
  shortcut: ReactNode;
  explanation: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="min-w-0 flex-1 leading-snug text-foreground">
        {explanation}
      </span>
      <div
        className={cn(
          "mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-md border border-border/60 bg-muted/35 px-2 py-1",
          "[&_kbd[data-slot=kbd]]:bg-transparent",
        )}
      >
        {shortcut}
      </div>
    </div>
  );
}

function renderShortcut(
  definition: ShortcutDefinition,
  modLabel: string,
): ReactNode {
  return (
    <KbdGroup>
      {definition.keys.map((key, index) => (
        <Fragment key={`${definition.explanation}-${key}-${index}`}>
          {index > 0 ? (
            <span className="text-muted-foreground" aria-hidden>
              +
            </span>
          ) : null}
          <Kbd>{key === "mod" ? modLabel : key}</Kbd>
        </Fragment>
      ))}
    </KbdGroup>
  );
}

export function KeyboardShortcutsHelp({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const mod = useMemo(() => modKeyLabel(), []);

  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-40">
      <div className="pointer-events-auto">
        <Popover open={open} onOpenChange={onOpenChange}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-11 w-11 rounded-full border-border/70 bg-background/85 shadow-xs backdrop-blur-sm hover:bg-muted/50"
              aria-label="Keyboard shortcuts"
            >
              <CircleHelp
                className="h-5 w-5 text-muted-foreground"
                aria-hidden
              />
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
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-2.5">
                <div className="text-[11px] font-medium tracking-[0.18em] text-muted-foreground uppercase">
                  Global
                </div>
                {GLOBAL_SHORTCUTS.map((definition) => (
                  <ShortcutLine
                    key={definition.explanation}
                    shortcut={renderShortcut(definition, mod)}
                    explanation={definition.explanation}
                  />
                ))}
              </div>
              <div className="h-px bg-border/70" />
              <div className="flex flex-col gap-2.5">
                <div className="text-[11px] font-medium tracking-[0.18em] text-muted-foreground uppercase">
                  In context
                </div>
                {CONTEXT_SHORTCUTS.map((definition) => (
                  <ShortcutLine
                    key={definition.explanation}
                    shortcut={renderShortcut(definition, mod)}
                    explanation={definition.explanation}
                  />
                ))}
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
