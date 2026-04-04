import type { NavigateFunction } from "react-router-dom";

function historyIdx(): number | undefined {
  const state = window.history.state;
  if (typeof state !== "object" || state === null) return undefined;
  if (!("idx" in state)) return undefined;
  const v = (state as { idx?: unknown }).idx;
  return typeof v === "number" ? v : undefined;
}

/**
 * Prefer one step back in the session history; fall back when the stack is too shallow
 * (e.g. deep-linked first paint) so we do not rely on an empty or external history entry.
 */
export function navigateBackOrFallback(
  navigate: NavigateFunction,
  fallback: string = "/",
): void {
  const idx = historyIdx();
  if (typeof idx === "number" && idx > 0) {
    navigate(-1);
    return;
  }
  if (window.history.length > 1) {
    navigate(-1);
    return;
  }
  navigate(fallback);
}
