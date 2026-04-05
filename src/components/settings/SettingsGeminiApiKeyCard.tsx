import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { invokeErrorText } from "@/lib/errors";

type GeminiApiKeySource = "environment" | "appStorage" | "none";

type GeminiApiKeyStatus = {
  configured: boolean;
  source: GeminiApiKeySource;
};

export function SettingsGeminiApiKeyCard({
  onSaved,
  onStoredKeyCleared,
}: {
  onSaved?: () => void;
  onStoredKeyCleared?: () => void;
}) {
  const [status, setStatus] = useState<GeminiApiKeyStatus | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const s = await invoke<GeminiApiKeyStatus>("gemini_api_key_status");
      setStatus(s);
    } catch (e) {
      setError(invokeErrorText(e));
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  async function handleSave() {
    setError(null);
    setBusy(true);
    try {
      await invoke("save_gemini_api_key", {
        args: { apiKey: draft },
      });
      setDraft("");
      await refreshStatus();
      onSaved?.();
    } catch (e) {
      setError(invokeErrorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleClearStored() {
    setError(null);
    setBusy(true);
    try {
      await invoke("clear_stored_gemini_api_key");
      await refreshStatus();
      onStoredKeyCleared?.();
    } catch (e) {
      setError(invokeErrorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card size="sm" className="shadow-xs">
      <CardHeader>
        <CardTitle>Gemini</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor="gemini-api-key">GEMINI_API_KEY</Label>
          <Input
            id="gemini-api-key"
            type="password"
            autoComplete="off"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={busy}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            disabled={busy || !draft.trim()}
            onClick={() => void handleSave()}
          >
            Save
          </Button>
          {status?.source === "appStorage" ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void handleClearStored()}
            >
              Remove
            </Button>
          ) : null}
        </div>
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
