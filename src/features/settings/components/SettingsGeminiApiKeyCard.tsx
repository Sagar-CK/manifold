import { Delete02Icon, PencilIcon } from "@hugeicons/core-free-icons";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppAlert } from "@/components/app/AppAlert";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { HugeIcon } from "@/components/ui/huge-icon";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
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
      <FieldLabel htmlFor="gemini-api-key">Gemini API Key</FieldLabel>
      <FieldDescription>Required for indexing.</FieldDescription>

      {editing ? (
        <InputGroup className="w-full max-w-sm">
          <InputGroupInput
            id="gemini-api-key"
            type="password"
            autoComplete="off"
            placeholder="Paste API Key"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={busy}
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
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              type="button"
              disabled={busy || !draft.trim()}
              onClick={() => void handleSave()}
            >
              Save
            </InputGroupButton>
            <InputGroupButton
              type="button"
              disabled={busy}
              onClick={handleCancelEdit}
            >
              Cancel
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      ) : (
        <div className="w-full max-w-sm">
          {status === null ? (
            <Skeleton className="h-7 w-full rounded-md" aria-hidden />
          ) : (
            <InputGroup data-disabled={busy ? true : undefined}>
              <InputGroupInput
                id="gemini-api-key"
                type="password"
                value={hasSavedKey ? "saved-api-key" : ""}
                placeholder="No API Key"
                readOnly
                disabled={busy}
                aria-label="Saved Gemini API Key"
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  type="button"
                  size="icon-xs"
                  disabled={busy}
                  aria-label={hasSavedKey ? "Change API Key" : "Add API Key"}
                  onClick={() => setEditing(true)}
                >
                  <HugeIcon icon={PencilIcon} aria-hidden />
                </InputGroupButton>
                {hasSavedKey ? (
                  <InputGroupButton
                    type="button"
                    size="icon-xs"
                    disabled={busy}
                    aria-label="Remove API Key"
                    onClick={() => void handleClearStored()}
                  >
                    <HugeIcon icon={Delete02Icon} aria-hidden />
                  </InputGroupButton>
                ) : null}
              </InputGroupAddon>
            </InputGroup>
          )}
        </div>
      )}

      <AppAlert variant="inline" message={error} />
    </Field>
  );
}
