import { hexToHsva, hsvaToHex } from "@uiw/color-convert";
import ShadeSlider from "@uiw/react-color-shade-slider";
import Wheel from "@uiw/react-color-wheel";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { normalizeTagHexColor } from "./tagColorPresets";

const COLOR_WHEEL_SIZE = 168;
const SHADE_SLIDER_HEIGHT = 16;
const SHADE_SLIDER_THUMB_SIZE = 12;

export function TagColorPicker({
  value,
  onChange,
  id = "tag-create-color",
  className,
  buttonClassName,
  swatchClassName,
}: {
  value: string;
  onChange: (color: string) => void;
  id?: string;
  className?: string;
  buttonClassName?: string;
  swatchClassName?: string;
}) {
  const normalizedValue = normalizeTagHexColor(value) ?? value.toLowerCase();
  const hsva = useMemo(() => hexToHsva(normalizedValue), [normalizedValue]);
  const [hexDraft, setHexDraft] = useState(normalizedValue);

  useEffect(() => {
    setHexDraft(normalizedValue);
  }, [normalizedValue]);

  function commitHsva(nextHsva: typeof hsva) {
    const nextHex = normalizeTagHexColor(hsvaToHex(nextHsva));
    if (nextHex) {
      onChange(nextHex);
    }
  }

  return (
    <Field className={cn("gap-3", className)}>
      <FieldLabel htmlFor={id}>Color</FieldLabel>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            id={id}
            variant="outline"
            className={cn(
              "h-7 w-full justify-center gap-1.5 px-2 font-normal",
              buttonClassName,
            )}
            aria-label={`Tag color ${normalizedValue}`}
          >
            <span
              className={cn(
                "size-3.5 shrink-0 rounded-full border border-border/60",
                swatchClassName,
              )}
              style={{ backgroundColor: normalizedValue }}
              aria-hidden
            />
            <span className="font-mono text-xs text-muted-foreground">
              {normalizedValue}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="z-[100] w-64 gap-3 p-3">
          <div className="flex flex-col items-center gap-3">
            <Wheel
              color={hsva}
              width={COLOR_WHEEL_SIZE}
              height={COLOR_WHEEL_SIZE}
              onChange={(color) => commitHsva({ ...hsva, ...color.hsva })}
            />
            <div className="flex w-full items-center gap-2">
              <span
                className="size-6 shrink-0 rounded-full border border-border/60"
                style={{ backgroundColor: normalizedValue }}
                aria-hidden
              />
              <ShadeSlider
                hsva={hsva}
                className="min-w-0 flex-1"
                height={SHADE_SLIDER_HEIGHT}
                radius={999}
                pointer={({
                  className: pointerClassName,
                  fillProps,
                  left,
                  prefixCls,
                  style,
                  top,
                  ...pointerProps
                }) => (
                  <div
                    className={`${prefixCls}-pointer ${pointerClassName ?? ""}`}
                    style={{
                      ...style,
                      left,
                      position: "absolute",
                      top,
                    }}
                    {...pointerProps}
                  >
                    <div
                      className={`${prefixCls}-fill`}
                      {...fillProps}
                      style={{
                        width: SHADE_SLIDER_THUMB_SIZE,
                        height: SHADE_SLIDER_THUMB_SIZE,
                        borderRadius: "50%",
                        backgroundColor: "rgb(248, 248, 248)",
                        boxShadow: "rgb(0 0 0 / 37%) 0px 1px 4px 0px",
                        transform: `translate(-${SHADE_SLIDER_THUMB_SIZE / 2}px, ${
                          (SHADE_SLIDER_HEIGHT - SHADE_SLIDER_THUMB_SIZE) / 2
                        }px)`,
                        ...fillProps?.style,
                      }}
                    />
                  </div>
                )}
                onChange={(newShade) => commitHsva({ ...hsva, ...newShade })}
              />
            </div>
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
            <FieldDescription>Hex code</FieldDescription>
          </Field>
        </PopoverContent>
      </Popover>
    </Field>
  );
}
