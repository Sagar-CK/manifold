import { HelpCircleIcon } from "@hugeicons/core-free-icons";
import { Fragment, type ReactNode, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { HugeIcon } from "@/components/ui/huge-icon";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import {
  CONTEXT_SHORTCUTS,
  GLOBAL_SHORTCUTS,
  type ShortcutDefinition,
} from "@/lib/app/shortcuts";

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
    <div className="flex items-center justify-between gap-3 py-0.5">
      <span className="min-w-0 text-xs/relaxed text-foreground">
        {explanation}
      </span>
      <div className="shrink-0">{shortcut}</div>
    </div>
  );
}

function ShortcutSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      <div className="flex flex-col gap-0.5">{children}</div>
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
            <span className="text-[10px] text-muted-foreground" aria-hidden>
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
              size="icon-sm"
              className="rounded-full border-border/70 bg-background/85 shadow-xs backdrop-blur-sm"
              aria-label="Keyboard shortcuts"
            >
              <HugeIcon
                icon={HelpCircleIcon}
                className="text-muted-foreground"
                aria-hidden
              />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            side="top"
            align="end"
            sideOffset={8}
            className="w-[min(100vw-2rem,16.5rem)] gap-2 p-3 text-xs/relaxed"
          >
            <PopoverHeader className="gap-0 pb-0">
              <PopoverTitle className="text-sm">Shortcuts</PopoverTitle>
            </PopoverHeader>
            <div className="flex flex-col gap-2">
              <ShortcutSection title="Global">
                {GLOBAL_SHORTCUTS.map((definition) => (
                  <ShortcutLine
                    key={definition.explanation}
                    shortcut={renderShortcut(definition, mod)}
                    explanation={definition.explanation}
                  />
                ))}
              </ShortcutSection>
              <Separator />
              <ShortcutSection title="In Context">
                {CONTEXT_SHORTCUTS.map((definition) => (
                  <ShortcutLine
                    key={definition.explanation}
                    shortcut={renderShortcut(definition, mod)}
                    explanation={definition.explanation}
                  />
                ))}
              </ShortcutSection>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
