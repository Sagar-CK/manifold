import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { EmbeddingImagePreset, LocalConfig } from "@/lib/localConfig";

const PRESETS: {
  value: EmbeddingImagePreset;
  label: string;
  detail: string;
}[] = [
  {
    value: "fast",
    label: "Faster",
    detail: "768px max edge for faster image and OCR indexing.",
  },
  {
    value: "balanced",
    label: "Balanced",
    detail: "1536px max edge for a balance of detail and speed.",
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
  return (
    <Card size="sm" className="shadow-xs">
      <CardHeader>
        <CardTitle className="app-section-title">Embedding images</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <Button
              key={p.value}
              type="button"
              size="sm"
              variant={
                cfg.embeddingImagePreset === p.value ? "secondary" : "outline"
              }
              onClick={() =>
                updateConfig({ ...cfg, embeddingImagePreset: p.value })
              }
            >
              {p.label}
            </Button>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">
          {PRESETS.find((p) => p.value === cfg.embeddingImagePreset)?.detail ??
            PRESETS[1].detail}
        </p>
      </CardContent>
    </Card>
  );
}
