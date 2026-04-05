/// <reference lib="webworker" />

import * as druid from "@saehrimnir/druidjs";

export type GraphLayoutAlgorithm = "pca" | "umap" | "tsne";

export type GraphLayoutRequest = {
  id: number;
  vectors: Float32Array;
  n: number;
  d: number;
  algorithm: GraphLayoutAlgorithm;
};

export type GraphLayoutResponse =
  | { id: number; ok: true; x: Float64Array; y: Float64Array }
  | { id: number; ok: false; error: string };

const rowPool: number[][] = [];

function rowsFromFlat(vectors: Float32Array, n: number, d: number): number[][] {
  while (rowPool.length < n) {
    rowPool.push(new Array(d));
  }
  for (let i = 0; i < n; i++) {
    const row = rowPool[i]!;
    if (row.length !== d) row.length = d;
    const start = i * d;
    for (let j = 0; j < d; j++) {
      row[j] = vectors[start + j]!;
    }
  }
  return rowPool.slice(0, n);
}

function xyFrom2D(transformed: number[][]): { x: number[]; y: number[] } {
  const x: number[] = [];
  const y: number[] = [];
  for (let i = 0; i < transformed.length; i++) {
    const row = transformed[i]!;
    x.push(row[0] ?? 0);
    y.push(row[1] ?? 0);
  }
  return { x, y };
}

/**
 * PCA/UMAP/t-SNE all use [@saehrimnir/druidjs](https://github.com/saehm/druidjs), matching
 * [qdrant-web-ui VisualizeChart worker](https://github.com/qdrant/qdrant-web-ui/blob/master/src/components/VisualizeChart/worker.js)
 * (`new druid.PCA(data, {})` then `D.transform()` for PCA).
 */
function runPca(rows: number[][]): { x: number[]; y: number[] } {
  if (rows.length < 2) {
    throw new Error("Need at least 2 points for PCA.");
  }
  const D = new druid.PCA(rows, {});
  const transformed = D.transform() as number[][];
  return xyFrom2D(transformed);
}

async function runUmap(rows: number[][]): Promise<{ x: number[]; y: number[] }> {
  const n = rows.length;
  if (n < 2) {
    throw new Error("Need at least 2 points for UMAP.");
  }
  const nNeighbors = Math.min(15, Math.max(2, n - 1));
  const D = new druid.UMAP(rows, {
    d: 2,
    n_neighbors: nNeighbors,
    min_dist: 0.1,
  });
  const transformed = D.transform(500) as number[][];
  return xyFrom2D(transformed);
}

function runTsne(rows: number[][]): { x: number[]; y: number[] } {
  const n = rows.length;
  if (n < 2) {
    throw new Error("Need at least 2 points for t-SNE.");
  }
  const perplexity = Math.min(30, Math.max(5, n - 1));
  const D = new druid.TSNE(rows, {
    d: 2,
    perplexity,
    epsilon: 10,
  });
  const transformed = D.transform(500) as number[][];
  return xyFrom2D(transformed);
}

self.onmessage = async (ev: MessageEvent<GraphLayoutRequest>) => {
  const { id, vectors, n, d, algorithm } = ev.data;
  try {
    if (n <= 0 || d <= 0 || vectors.length < n * d) {
      throw new Error("Invalid vector buffer.");
    }
    const rows = rowsFromFlat(vectors, n, d);
    let x: number[];
    let y: number[];
    if (algorithm === "pca") {
      ({ x, y } = runPca(rows));
    } else if (algorithm === "umap") {
      ({ x, y } = await runUmap(rows));
    } else {
      ({ x, y } = runTsne(rows));
    }
    const res: GraphLayoutResponse = {
      id,
      ok: true,
      x: Float64Array.from(x),
      y: Float64Array.from(y),
    };
    postMessage(res, [res.x.buffer, res.y.buffer]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const res: GraphLayoutResponse = { id, ok: false, error: msg };
    postMessage(res);
  }
};
