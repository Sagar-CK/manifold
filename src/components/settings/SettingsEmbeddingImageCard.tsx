import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@/components/ui/field";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { EmbeddingImagePreset, LocalConfig } from "@/lib/localConfig";

const PRESETS: {
  value: EmbeddingImagePreset;
  label: string;
  detail: string;
}[] = [
  {
    value: "fast",
    label: "Faster",
    detail: "768px max edge — fastest indexing.",
  },
  {
    value: "balanced",
    label: "Balanced",
    detail: "1536px max edge — good balance of detail and speed.",
  },
  {
    value: "highQuality",
    label: "Higher quality",
    detail: "1536px max edge with higher JPEG quality.",
  },
];

export function SettingsEmbeddingImageCard({
  cfg,
  updateConfig,
}: {
  cfg: LocalConfig;
  updateConfig: (next: LocalConfig) => void;
}) {
  const active = PRESETS.find((p) => p.value === cfg.embeddingImagePreset);

  return (
    <Field>
      <FieldLabel>Image embedding quality</FieldLabel>
      <FieldDescription>
        {active?.detail ?? PRESETS[1].detail}
      </FieldDescription>
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
        aria-label="Image embedding quality"
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
