import type {
  GraphLayoutAlgorithm,
  GraphLayoutRequest,
  GraphLayoutResponse,
  GraphLayoutResponseMetrics,
} from "@/workers/graphLayout.worker";

export type { GraphLayoutAlgorithm };

const superseded = () => new Error("Graph layout superseded");

let worker: Worker | null = null;
let nextJobId = 0;
const pendingById = new Map<
  number,
  {
    resolve: (v: {
      x: Float32Array;
      y: Float32Array;
      metrics: GraphLayoutResponseMetrics;
    }) => void;
    reject: (e: unknown) => void;
  }
>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(
      new URL("../workers/graphLayout.worker.ts", import.meta.url),
      {
        type: "module",
      },
    );
    worker.addEventListener(
      "message",
      (ev: MessageEvent<GraphLayoutResponse>) => {
        const r = ev.data;
        const id = r.id;
        const p = pendingById.get(id);
        if (!p) return;
        pendingById.delete(id);
        if (r.ok) {
          p.resolve({ x: r.x, y: r.y, metrics: r.metrics });
        } else {
          p.reject(new Error(r.error));
        }
      },
    );
    worker.addEventListener("error", (err) => {
      const e = err.error ?? new Error(String(err.message));
      for (const [, p] of pendingById) {
        p.reject(e);
      }
      pendingById.clear();
      try {
        worker?.terminate();
      } catch {}
      worker = null;
    });
  }
  return worker;
}

export function runGraphLayout(
  packedEmbeddingsF32Base64: string,
  n: number,
  d: number,
  algorithm: GraphLayoutAlgorithm,
): Promise<{
  x: Float32Array;
  y: Float32Array;
  metrics: GraphLayoutResponseMetrics;
}> {
  const w = getWorker();
  const id = ++nextJobId;
  for (const p of pendingById.values()) {
    p.reject(superseded());
  }
  pendingById.clear();
  return new Promise((resolve, reject) => {
    pendingById.set(id, { resolve, reject });
    const req: GraphLayoutRequest = {
      id,
      packedEmbeddingsF32Base64,
      n,
      d,
      algorithm,
    };
    w.postMessage(req);
  });
}
