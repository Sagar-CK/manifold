import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Toggle } from "@/components/ui/toggle";
import type { LocalConfig, SupportedExt } from "@/lib/config/localConfig";
import { SEARCH_MODE_OPTIONS } from "./searchModeOptions";

const SETTINGS_FIELD_CLASS = "gap-2.5";
const SETTINGS_FIELD_TEXT_CLASS = "flex flex-col gap-1";
const SEARCH_FIELD_CLASS = SETTINGS_FIELD_CLASS;
const SEARCH_FIELD_TEXT_CLASS = SETTINGS_FIELD_TEXT_CLASS;
const SEARCH_CONTROL_CLASS =
  "h-7 w-full px-2 py-1 text-xs/relaxed md:text-xs/relaxed sm:w-48";
const SEARCH_SELECT_TRIGGER_CLASS =
  "h-7 w-full text-xs/relaxed data-[size=default]:h-7 sm:w-48";

export function SettingsFileTypesCard({
  cfg,
  updateConfig,
  extOptions,
}: {
  cfg: LocalConfig;
  updateConfig: (next: LocalConfig) => void;
  extOptions: SupportedExt[];
}) {
  function updateExtension(ext: SupportedExt, pressed: boolean) {
    const selected = new Set(cfg.extensions);
    if (pressed) {
      selected.add(ext);
    } else {
      selected.delete(ext);
    }
    updateConfig({
      ...cfg,
      extensions: extOptions.filter((option) => selected.has(option)),
    });
  }

  return (
    <Field className={SETTINGS_FIELD_CLASS}>
      <div className={SETTINGS_FIELD_TEXT_CLASS}>
        <FieldLabel>File Types</FieldLabel>
        <FieldDescription>
          Extensions included when scanning folders.
        </FieldDescription>
      </div>
      <div
        className="flex w-full flex-wrap items-center gap-2"
        role="group"
        aria-label="Indexed File Extensions"
      >
        {extOptions.map((ext) => (
          <Toggle
            key={ext}
            pressed={cfg.extensions.includes(ext)}
            onPressedChange={(pressed) => updateExtension(ext, pressed)}
            variant="outline"
            className="min-w-12 justify-center lowercase"
            aria-label={`Include ${ext.toUpperCase()} Files`}
          >
            {ext}
          </Toggle>
        ))}
      </div>
    </Field>
  );
}

export function SettingsSearchPreferencesCard({
  cfg,
  updateConfig,
  topKDraft,
  setTopKDraft,
}: {
  cfg: LocalConfig;
  updateConfig: (next: LocalConfig) => void;
  topKDraft: string;
  setTopKDraft: (v: string) => void;
}) {
  return (
    <FieldGroup className="gap-5">
      <Field className={SEARCH_FIELD_CLASS}>
        <div className={SEARCH_FIELD_TEXT_CLASS}>
          <FieldLabel htmlFor="search-mode">Ranking</FieldLabel>
          <FieldDescription>
            How results are ordered and filtered.
          </FieldDescription>
        </div>
        <Select
          value={cfg.searchMode}
          onValueChange={(value) => {
            updateConfig({
              ...cfg,
              searchMode: value as LocalConfig["searchMode"],
            });
          }}
        >
          <SelectTrigger
            id="search-mode"
            className={SEARCH_SELECT_TRIGGER_CLASS}
          >
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
        <Field className={SEARCH_FIELD_CLASS}>
          <div className={SEARCH_FIELD_TEXT_CLASS}>
            <FieldLabel htmlFor="topk">Result Limit</FieldLabel>
            <FieldDescription>
              Maximum number of matches returned per search.
            </FieldDescription>
          </div>
          <Input
            id="topk"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={topKDraft}
            className={`${SEARCH_CONTROL_CLASS} tabular-nums`}
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
        <Field className={SEARCH_FIELD_CLASS}>
          <div className={SEARCH_FIELD_TEXT_CLASS}>
            <div className="flex items-center justify-between gap-3">
              <FieldLabel>Minimum Score</FieldLabel>
              <span className="text-sm tabular-nums font-medium">
                {Math.round(cfg.scoreThreshold * 100)}%
              </span>
            </div>
            <FieldDescription>
              Only show results at or above this similarity.
            </FieldDescription>
          </div>
          <Slider
            min={0}
            max={100}
            step={1}
            value={[Math.round(cfg.scoreThreshold * 100)]}
            onValueChange={(value) => {
              const next = value?.[0];
              if (typeof next !== "number" || Number.isNaN(next)) {
                return;
              }
              updateConfig({
                ...cfg,
                scoreThreshold: Math.max(0, Math.min(1, next / 100)),
              });
            }}
            className="w-full"
          />
        </Field>
      )}

      <Field orientation="horizontal" className="gap-3">
        <FieldContent className="gap-1">
          <FieldLabel htmlFor="sim-hover">Similarity on Hover</FieldLabel>
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
          aria-label="Toggle Similarity Badge on Hover"
        />
      </Field>
    </FieldGroup>
  );
}
