import { Tick02Icon } from "@hugeicons/core-free-icons";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@/components/ui/field";
import { HugeIcon } from "@/components/ui/huge-icon";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  normalizeTagHexColor,
  TAG_COLOR_PRESETS,
} from "./tagColorPresets";

export function TagColorPicker({
  value,
  onChange,
  id = "tag-create-color",
}: {
  value: string;
  onChange: (color: string) => void;
  id?: string;
}) {
  const normalizedValue = normalizeTagHexColor(value) ?? value.toLowerCase();
  const [hexDraft, setHexDraft] = useState(normalizedValue);

  useEffect(() => {
    setHexDraft(normalizedValue);
  }, [normalizedValue]);

  return (
    <Field className="gap-3">
      <FieldLabel htmlFor={id}>Color</FieldLabel>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            id={id}
            variant="outline"
            className="h-9 w-fit gap-2 px-2.5 font-normal"
            aria-label={`Tag color ${normalizedValue}`}
          >
            <span
              className="size-4 shrink-0 rounded-full border border-border/60"
              style={{ backgroundColor: normalizedValue }}
              aria-hidden
            />
            <span className="font-mono text-xs text-muted-foreground">
              {normalizedValue}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="z-[100] w-56 gap-3 p-3">
          <div className="grid grid-cols-5 gap-2">
            {TAG_COLOR_PRESETS.map((color) => {
              const selected =
                normalizedValue.toLowerCase() === color.toLowerCase();
              return (
                <button
                  key={color}
                  type="button"
                  className={cn(
                    "relative flex size-8 items-center justify-center rounded-full border transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                    selected
                      ? "border-foreground ring-2 ring-ring/30"
                      : "border-border/60",
                  )}
                  style={{ backgroundColor: color }}
                  aria-label={color}
                  aria-pressed={selected}
                  onClick={() => onChange(color)}
                >
                  {selected ? (
                    <HugeIcon
                      icon={Tick02Icon}
                      className="size-3.5 text-white drop-shadow-sm"
                      aria-hidden
                    />
                  ) : null}
                </button>
              );
            })}
          </div>
          <Field className="gap-1.5">
            <FieldLabel htmlFor={`${id}-hex`} className="text-xs">
              Custom
            </FieldLabel>
            <Input
              id={`${id}-hex`}
              value={hexDraft}
              placeholder="#6366f1"
              className="h-8 font-mono text-xs"
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => setHexDraft(e.target.value)}
              onBlur={() => {
                const next = normalizeTagHexColor(hexDraft);
                if (next) {
                  onChange(next);
                  setHexDraft(next);
                } else {
                  setHexDraft(normalizedValue);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
              }}
            />
            <FieldDescription>6-digit hex, with or without #</FieldDescription>
          </Field>
        </PopoverContent>
      </Popover>
    </Field>
  );
}
