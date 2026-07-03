import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type {
  EmbeddingImagePreset,
  LocalConfig,
} from "@/lib/config/localConfig";

const PRESETS: {
  value: EmbeddingImagePreset;
  label: string;
  detail: string;
}[] = [
  {
    value: "fast",
    label: "Faster",
    detail: "768px max edge. JPEG quality 72.",
  },
  {
    value: "balanced",
    label: "Balanced",
    detail: "1536px max edge. JPEG quality 85.",
  },
  {
    value: "highQuality",
    label: "Higher Quality",
    detail: "1536px max edge. JPEG quality 92.",
  },
];

const SETTINGS_FIELD_CLASS = "gap-2.5";
const SETTINGS_FIELD_TEXT_CLASS = "flex flex-col gap-1";

export function SettingsEmbeddingImageCard({
  cfg,
  updateConfig,
}: {
  cfg: LocalConfig;
  updateConfig: (next: LocalConfig) => void;
}) {
  const active = PRESETS.find((p) => p.value === cfg.embeddingImagePreset);

  return (
    <Field className={SETTINGS_FIELD_CLASS}>
      <div className={SETTINGS_FIELD_TEXT_CLASS}>
        <FieldLabel>Image Indexing Quality</FieldLabel>
        <FieldDescription>
          {active?.detail ?? PRESETS[1].detail}
        </FieldDescription>
      </div>
      <ToggleGroup
        type="single"
        value={cfg.embeddingImagePreset}
        onValueChange={(v) => {
          const next = (v || "balanced") as EmbeddingImagePreset;
          updateConfig({
            ...cfg,
            embeddingImagePreset: next,
          });
        }}
        variant="segmented"
        spacing={0}
        className="w-full sm:w-fit"
        aria-label="Image Indexing Quality"
      >
        {PRESETS.map((p) => (
          <ToggleGroupItem key={p.value} value={p.value}>
            {p.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </Field>
  );
}
