import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@/components/ui/field";

export function SettingsAppearanceCard({
  themeMounted,
  theme,
  setTheme,
}: {
  themeMounted: boolean;
  theme: string | undefined;
  setTheme: (t: "light" | "dark" | "system") => void;
}) {
  return (
    <Field>
      <FieldLabel>Theme</FieldLabel>
      <FieldDescription>Color theme for the app window.</FieldDescription>
      {themeMounted ? (
        <ToggleGroup
          type="single"
          value={theme ?? "system"}
          onValueChange={(v) => {
            const next = (v || "system") as "light" | "dark" | "system";
            setTheme(next);
          }}
          variant="segmented"
          spacing={0}
          className="w-full sm:w-fit"
          aria-label="Theme"
        >
          <ToggleGroupItem value="light">Light</ToggleGroupItem>
          <ToggleGroupItem value="dark">Dark</ToggleGroupItem>
          <ToggleGroupItem value="system">System</ToggleGroupItem>
        </ToggleGroup>
      ) : (
        <Skeleton className="h-8 w-full max-w-xs rounded-lg" aria-hidden />
      )}
    </Field>
  );
}
