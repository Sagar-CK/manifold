import { Delete02Icon, PencilIcon } from "@hugeicons/core-free-icons";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppAlert } from "@/components/AppAlert";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@/components/ui/field";
import { HugeIcon } from "@/components/ui/huge-icon";
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
} from "@/lib/api/desktop";
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
    setEditing(!status.configured);
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
    setEditing(!status?.configured);
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

  const hasSavedKey = status?.configured ?? false;

  return (
    <Field>
      <FieldLabel htmlFor="gemini-api-key">Gemini API key</FieldLabel>
      <FieldDescription>Required for embeddings.</FieldDescription>

      {editing ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            id="gemini-api-key"
            type="password"
            autoComplete="off"
            placeholder="Paste API key…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={busy}
            className="h-8 text-xs sm:flex-1"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleSave();
              }
              if (e.key === "Escape") {
                e.preventDefault();
                handleCancelEdit();
              }
            }}
          />
          <div className="flex gap-2">
            <Button
              type="button"
              disabled={busy || !draft.trim()}
              onClick={() => void handleSave()}
            >
              Save
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={handleCancelEdit}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex h-8 w-full sm:w-fit sm:min-w-[14rem] items-center rounded-lg bg-muted p-[3px]">
          <p className="min-w-0 flex-1 truncate px-1.5 font-mono text-xs text-muted-foreground">
            {hasSavedKey ? "••••••••••••••••" : "No key saved"}
          </p>
          <div className="flex h-full shrink-0 items-center gap-0.5 pr-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="size-6 rounded-md text-muted-foreground"
                  disabled={busy}
                  aria-label={hasSavedKey ? "Change API key" : "Add API key"}
                  onClick={() => setEditing(true)}
                >
                  <HugeIcon icon={PencilIcon} className="size-3" aria-hidden />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">
                {hasSavedKey ? "Change" : "Add key"}
              </TooltipContent>
            </Tooltip>
            {hasSavedKey ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="size-6 rounded-md text-muted-foreground"
                    disabled={busy}
                    aria-label="Remove API key"
                    onClick={() => void handleClearStored()}
                  >
                    <HugeIcon icon={Delete02Icon} className="size-3" aria-hidden />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">Remove</TooltipContent>
              </Tooltip>
            ) : null}
          </div>
        </div>
      )}

      <AppAlert variant="inline" message={error} />
    </Field>
  );
}
