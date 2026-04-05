/**
 * Opt-in timing logs for the graph explorer load pipeline (share console output for debugging).
 *
 * Enable: `localStorage.setItem('manifold.debug.graphPerf', '1')` then reload.
 * Disable: `localStorage.removeItem('manifold.debug.graphPerf')`
 *
 * Timestamps are wall-clock ISO; `+NNms` is elapsed ms since `session_start` for the winning load (after Qdrant returns). Duplicate `session_start` lines in dev were from React Strict Mode — the graph effect now drops stale effect runs so you should see a single pipeline.
 */

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

/** Call at the beginning of each graph load (runLoad). */
export function graphPerfSessionStart(): void {
  sessionStartMs = performance.now();
  if (!isGraphPerfDebugEnabled()) return;
  console.log(`[graph-perf] ${isoNow()} session_start`);
}

/**
 * @param phase Short label, e.g. `invoke_qdrant_scroll_graph_done`
 * @param extra Optional JSON-serializable fields (sizes, counts)
 */
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
