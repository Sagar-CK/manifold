import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

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
    <Card size="sm" className="shadow-xs">
      <CardHeader>
        <CardTitle>Appearance</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {themeMounted ? (
          (["light", "dark", "system"] as const).map((t) => (
            <Button
              key={t}
              type="button"
              size="sm"
              variant={theme === t ? "secondary" : "outline"}
              onClick={() => setTheme(t)}
            >
              {t === "system" ? "System" : t === "light" ? "Light" : "Dark"}
            </Button>
          ))
        ) : (
          <div
            className="h-9 w-full max-w-xs animate-pulse rounded-md bg-muted"
            aria-hidden
          />
        )}
      </CardContent>
    </Card>
  );
}
