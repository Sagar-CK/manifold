import { Pencil, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ErrorMessage } from "@/components/ErrorMessage";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  clearStoredGeminiApiKey,
  type GeminiApiKeyStatus,
  geminiApiKeyStatus,
  saveGeminiApiKey,
} from "@/lib/api/tauri";
import { invokeErrorText } from "@/lib/errors";

export function SettingsGeminiApiKeyCard({
  onSaved,
  onStoredKeyCleared,
}: {
  onSaved?: () => void;
  onStoredKeyCleared?: () => void;
}) {
  const [status, setStatus] = useState<GeminiApiKeyStatus | null>(null);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bootstrappedEditing = useRef(false);

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await geminiApiKeyStatus());
    } catch (e) {
      setError(invokeErrorText(e));
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    if (status === null || bootstrappedEditing.current) return;
    bootstrappedEditing.current = true;
    const hasKey = status.configured && status.source !== "none";
    setEditing(!hasKey);
  }, [status]);

  useEffect(() => {
    if (editing) {
      queueMicrotask(() => document.getElementById("gemini-api-key")?.focus());
    }
  }, [editing]);

  async function handleSave() {
    const key = draft.trim();
    if (!key) return;
    setError(null);
    setBusy(true);
    try {
      await saveGeminiApiKey(key);
      setDraft("");
      setEditing(false);
      await refreshStatus();
      onSaved?.();
    } catch (e) {
      setError(invokeErrorText(e));
    } finally {
      setBusy(false);
    }
  }

  function handleCancelEdit() {
    setDraft("");
    setError(null);
    const hasKey = status?.configured && status.source !== "none";
    setEditing(!hasKey);
  }

  async function handleClearStored() {
    setError(null);
    setBusy(true);
    try {
      await clearStoredGeminiApiKey();
      setDraft("");
      setEditing(true);
      await refreshStatus();
      onStoredKeyCleared?.();
    } catch (e) {
      setError(invokeErrorText(e));
    } finally {
      setBusy(false);
    }
  }

  const hasConfiguredKey = status?.configured && status.source !== "none";
  const canRemoveStored = status?.source === "appStorage";

  return (
    <Card size="sm" className="shadow-xs">
      <CardHeader className="pb-2">
        <CardTitle className="app-section-title">Gemini API Key</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0">
        {editing ? (
          <div className="flex items-center gap-1">
            <Input
              id="gemini-api-key"
              className="min-w-0 flex-1"
              type="password"
              autoComplete="off"
              placeholder="sk-…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={busy}
              onBlur={() => {
                if (draft.trim()) {
                  void handleSave();
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  handleCancelEdit();
                }
              }}
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0"
                  aria-label="Cancel editing"
                  disabled={busy}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleCancelEdit()}
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left">Cancel</TooltipContent>
            </Tooltip>
          </div>
        ) : hasConfiguredKey ? (
          <div className="flex min-w-0 items-center gap-1">
            <div className="min-w-0 flex-1 truncate rounded-lg border border-border/70 bg-muted/15 px-2.5 py-1.5 font-mono text-xs text-muted-foreground">
              {status?.source === "environment"
                ? "Using key from environment"
                : "••••••••••••••••"}
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0"
                  aria-label="Edit API key"
                  disabled={busy}
                  onClick={() => setEditing(true)}
                >
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left">Edit</TooltipContent>
            </Tooltip>
            {canRemoveStored ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="shrink-0"
                    aria-label="Remove stored API key"
                    disabled={busy}
                    onClick={() => void handleClearStored()}
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="left">Remove</TooltipContent>
              </Tooltip>
            ) : null}
          </div>
        ) : (
          <div className="flex min-w-0 items-center gap-1">
            <p className="min-w-0 flex-1 text-sm text-muted-foreground">
              No key saved.
            </p>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0"
                  aria-label="Edit API key"
                  disabled={busy}
                  onClick={() => setEditing(true)}
                >
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left">Edit</TooltipContent>
            </Tooltip>
          </div>
        )}
        <ErrorMessage message={error} />
      </CardContent>
    </Card>
  );
}
