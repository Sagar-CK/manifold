// Opt-in: localStorage.setItem("manifold.debug.graphPerf", "1"), reload; remove key to disable.

const STORAGE_KEY = "manifold.debug.graphPerf";

export function isGraphPerfDebugEnabled(): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

let sessionStartMs = 0;

export function graphPerfSessionStart(): void {
  sessionStartMs = performance.now();
  if (!isGraphPerfDebugEnabled()) return;
  console.log(`[graph-perf] ${isoNow()} session_start`);
}

export function graphPerfMark(phase: string, extra?: Record<string, unknown>): void {
  if (!isGraphPerfDebugEnabled()) return;
  const wall = isoNow();
  const sinceSession = (performance.now() - sessionStartMs).toFixed(2);
  if (extra !== undefined && Object.keys(extra).length > 0) {
    console.log(`[graph-perf] ${wall} +${sinceSession}ms ${phase}`, extra);
  } else {
    console.log(`[graph-perf] ${wall} +${sinceSession}ms ${phase}`);
  }
}

function isoNow(): string {
  return new Date().toISOString();
}
