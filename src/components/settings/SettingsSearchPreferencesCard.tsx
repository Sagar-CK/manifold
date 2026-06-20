import { Input } from "@/components/ui/input";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { LocalConfig, SupportedExt } from "@/lib/localConfig";
import { SEARCH_MODE_OPTIONS } from "./searchModeOptions";

export function SettingsSearchPreferencesCard({
  cfg,
  updateConfig,
  extOptions,
  topKDraft,
  setTopKDraft,
}: {
  cfg: LocalConfig;
  updateConfig: (next: LocalConfig) => void;
  extOptions: SupportedExt[];
  topKDraft: string;
  setTopKDraft: (v: string) => void;
}) {
  return (
    <FieldGroup>
      <Field>
        <FieldLabel>File types</FieldLabel>
        <FieldDescription>
          Extensions included when scanning folders.
        </FieldDescription>
        <ToggleGroup
          type="multiple"
          value={cfg.extensions}
          onValueChange={(next) => {
            updateConfig({ ...cfg, extensions: next as SupportedExt[] });
          }}
          variant="segmented"
          spacing={0}
          className="h-auto w-full flex-wrap gap-2 p-1.5 sm:w-fit"
          aria-label="Indexed file extensions"
        >
          {extOptions.map((ext) => (
            <ToggleGroupItem key={ext} value={ext} className="lowercase">
              {ext}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Field>

      <Field>
        <FieldLabel htmlFor="search-mode">Ranking</FieldLabel>
        <FieldDescription>How results are ordered and filtered.</FieldDescription>
        <Select
          value={cfg.searchMode}
          onValueChange={(value) => {
            updateConfig({
              ...cfg,
              searchMode: value as LocalConfig["searchMode"],
            });
          }}
        >
          <SelectTrigger id="search-mode" className="w-full sm:w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SEARCH_MODE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {cfg.searchMode === "topK" ? (
        <Field>
          <FieldLabel htmlFor="topk">Result limit</FieldLabel>
          <FieldDescription>
            Maximum number of matches returned per search.
          </FieldDescription>
          <Input
            id="topk"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={topKDraft}
            className="w-full tabular-nums sm:w-24"
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
        </Field>
      ) : (
        <Field>
          <div className="flex items-center justify-between gap-3">
            <FieldLabel>Minimum score</FieldLabel>
            <span className="text-sm tabular-nums font-medium">
              {Math.round(cfg.scoreThreshold * 100)}%
            </span>
          </div>
          <FieldDescription>
            Only show results at or above this similarity.
          </FieldDescription>
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
        </Field>
      )}

      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel htmlFor="sim-hover">Similarity on hover</FieldLabel>
          <FieldDescription>
            Show match strength when hovering results.
          </FieldDescription>
        </FieldContent>
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
      </Field>
    </FieldGroup>
  );
}
