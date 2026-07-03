import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import type { LocalConfig } from "@/lib/config/localConfig";

export function SettingsTagsCard({
  cfg,
  updateConfig,
}: {
  cfg: LocalConfig;
  updateConfig: (next: LocalConfig) => void;
}) {
  return (
    <FieldGroup>
      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel htmlFor="auto-tagging">Automatic Tagging</FieldLabel>
          <FieldDescription>
            Suggest tags from file content when indexing.
          </FieldDescription>
        </FieldContent>
        <Switch
          id="auto-tagging"
          checked={cfg.autoTaggingEnabled}
          onCheckedChange={(checked) => {
            updateConfig({ ...cfg, autoTaggingEnabled: checked });
          }}
          aria-label="Toggle Automatic Tagging"
        />
      </Field>
    </FieldGroup>
  );
}
