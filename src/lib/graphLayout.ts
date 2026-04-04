import type { GraphLayoutAlgorithm, GraphLayoutRequest, GraphLayoutResponse } from "@/workers/graphLayout.worker";

export type { GraphLayoutAlgorithm };

export function runGraphLayout(
  vectors: Float32Array,
  n: number,
  d: number,
  algorithm: GraphLayoutAlgorithm,
): Promise<{ x: Float64Array; y: Float64Array }> {
  const copy = vectors.slice();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../workers/graphLayout.worker.ts", import.meta.url), {
      type: "module",
    });
    const onMsg = (ev: MessageEvent<GraphLayoutResponse>) => {
      worker.removeEventListener("message", onMsg);
      worker.removeEventListener("error", onErr);
      worker.terminate();
      const r = ev.data;
      if (r.ok) {
        resolve({ x: r.x, y: r.y });
      } else {
        reject(new Error(r.error));
      }
    };
    const onErr = (err: ErrorEvent) => {
      worker.removeEventListener("message", onMsg);
      worker.removeEventListener("error", onErr);
      worker.terminate();
      reject(err.error ?? new Error(String(err.message)));
    };
    worker.addEventListener("message", onMsg);
    worker.addEventListener("error", onErr);
    const req: GraphLayoutRequest = { vectors: copy, n, d, algorithm };
    worker.postMessage(req, [copy.buffer]);
  });
}
