import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { EmbeddingImagePreset, LocalConfig } from "@/lib/localConfig";

const PRESETS: {
  value: EmbeddingImagePreset;
  label: string;
  detail: string;
}[] = [
  {
    value: "fast",
    label: "Faster",
    detail: "768px max edge, stronger JPEG compression. Smaller uploads and quicker Gemini vision/OCR.",
  },
  {
    value: "balanced",
    label: "Balanced",
    detail: "1536px max edge, default quality. Matches the original embedding pipeline.",
  },
  {
    value: "highQuality",
    label: "Higher quality",
    detail: "Same max size as balanced with less compression. Slightly larger payloads, finer detail.",
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
        <CardTitle>Embedding images</CardTitle>
        <CardDescription>
          Controls how PNG/JPEG files are resized and compressed before they are sent to Gemini for
          embeddings and text extraction. PDFs and other types are unchanged.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <Button
              key={p.value}
              type="button"
              size="sm"
              variant={cfg.embeddingImagePreset === p.value ? "secondary" : "outline"}
              onClick={() => updateConfig({ ...cfg, embeddingImagePreset: p.value })}
            >
              {p.label}
            </Button>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">
          {
            PRESETS.find((p) => p.value === cfg.embeddingImagePreset)?.detail ??
            PRESETS[1].detail
          }
        </p>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Already indexed files keep their existing vectors until the file changes or you clear the
          index. After changing this, use{" "}
          <span className="font-medium text-foreground/90">Clear index</span> below if you want
          everything re-embedded with the new preset.
        </p>
      </CardContent>
    </Card>
  );
}
