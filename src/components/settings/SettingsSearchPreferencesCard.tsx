import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Toggle } from "@/components/ui/toggle";
import type { LocalConfig, SupportedExt } from "@/lib/localConfig";
import {
  SEARCH_MODE_OPTIONS,
  type SearchModeOption,
} from "./searchModeOptions";

export function SettingsSearchPreferencesCard({
  cfg,
  updateConfig,
  extOptions,
  topKDraft,
  setTopKDraft,
  selectedSearchModeOption,
}: {
  cfg: LocalConfig;
  updateConfig: (next: LocalConfig) => void;
  extOptions: SupportedExt[];
  topKDraft: string;
  setTopKDraft: (v: string) => void;
  selectedSearchModeOption: SearchModeOption | null;
}) {
  return (
    <Card size="sm" className="shadow-xs">
      <CardHeader>
        <CardTitle className="app-section-title">Search</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label className="text-muted-foreground">File types</Label>
          <div className="flex flex-wrap gap-2">
            {extOptions.map((ext) => (
              <Toggle
                key={ext}
                pressed={cfg.extensions.includes(ext)}
                onPressedChange={(pressed) => {
                  if (pressed === undefined) return;
                  const next = pressed
                    ? Array.from(new Set([...cfg.extensions, ext]))
                    : cfg.extensions.filter((x) => x !== ext);
                  updateConfig({ ...cfg, extensions: next });
                }}
                variant="outline"
                size="sm"
                className="h-auto min-w-0 border-border/70 px-3 py-1.5 font-normal data-[state=on]:border-border data-[state=on]:bg-muted data-[state=on]:text-foreground data-[state=off]:text-muted-foreground"
              >
                {ext}
              </Toggle>
            ))}
          </div>
        </div>

        <Separator />

        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Label className="text-muted-foreground">Ranking</Label>
            <Combobox<SearchModeOption>
              value={selectedSearchModeOption}
              onValueChange={(value) => {
                if (!value) return;
                updateConfig({
                  ...cfg,
                  searchMode: value.value,
                });
              }}
            >
              <ComboboxInput
                readOnly
                showClear={false}
                className="w-44"
                aria-label="Similarity mode"
              />
              <ComboboxContent>
                <ComboboxList>
                  {SEARCH_MODE_OPTIONS.map((option) => (
                    <ComboboxItem key={option.value} value={option}>
                      {option.label}
                    </ComboboxItem>
                  ))}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
          </div>

          <div className="flex flex-col gap-2">
            {cfg.searchMode === "topK" ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Label
                  htmlFor="topk"
                  className="shrink-0 text-muted-foreground"
                >
                  Result limit
                </Label>
                <Input
                  id="topk"
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  value={topKDraft}
                  className="h-9 w-20 text-right tabular-nums"
                  onChange={(e) => setTopKDraft(e.target.value)}
                  onBlur={() => {
                    const n = Number.parseInt(topKDraft.trim(), 10);
                    const next = Number.isNaN(n)
                      ? cfg.topK
                      : Math.max(1, Math.min(256, n));
                    updateConfig({ ...cfg, topK: next });
                    setTopKDraft(String(next));
                  }}
                />
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Min score</span>
                  <span className="tabular-nums font-medium">
                    {Math.round(cfg.scoreThreshold * 100)}%
                  </span>
                </div>
                <Slider
                  min={0}
                  max={100}
                  step={1}
                  value={[Math.round(cfg.scoreThreshold * 100)]}
                  onValueChange={(value) => {
                    const next = value?.[0];
                    if (typeof next !== "number" || Number.isNaN(next)) return;
                    updateConfig({
                      ...cfg,
                      scoreThreshold: Math.max(0, Math.min(1, next / 100)),
                    });
                  }}
                  className="w-full"
                />
              </div>
            )}
          </div>
        </div>

        <Separator />

        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="sim-hover" className="text-muted-foreground">
            Similarity on hover
          </Label>
          <Switch
            id="sim-hover"
            checked={cfg.showSimilarityOnHover}
            onCheckedChange={(checked) => {
              updateConfig({
                ...cfg,
                showSimilarityOnHover: checked,
              });
            }}
            aria-label="Toggle similarity badge on hover"
          />
        </div>
      </CardContent>
    </Card>
  );
}
