/// <reference lib="webworker" />

import * as druid from "@saehrimnir/druidjs";
import { decodePackedF32Base64 } from "@/lib/packedEmbeddings";

export type GraphLayoutAlgorithm = "pca" | "umap" | "tsne";

export type GraphLayoutRequest = {
  id: number;
  packedEmbeddingsF32Base64: string;
  n: number;
  d: number;
  algorithm: GraphLayoutAlgorithm;
};

export type GraphLayoutResponseMetrics = {
  decodeMs: number;
  rowConversionMs: number;
  layoutMs: number;
  normalizeMs: number;
};

export type GraphLayoutResponse =
  | {
      id: number;
      ok: true;
      x: Float32Array;
      y: Float32Array;
      metrics: GraphLayoutResponseMetrics;
    }
  | { id: number; ok: false; error: string };

const rowPool: number[][] = [];

function createEmptyMetrics(): GraphLayoutResponseMetrics {
  return {
    decodeMs: 0,
    rowConversionMs: 0,
    layoutMs: 0,
    normalizeMs: 0,
  };
}

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

function normalizeCoords(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
): { x: Float32Array; y: Float32Array } {
  const len = x.length;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < len; i++) {
    minX = Math.min(minX, x[i]!);
    minY = Math.min(minY, y[i]!);
    maxX = Math.max(maxX, x[i]!);
    maxY = Math.max(maxY, y[i]!);
  }
  const w = maxX - minX || 1;
  const h = maxY - minY || 1;
  const pad = 0.06;
  const nx = new Float32Array(len);
  const ny = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    nx[i] = pad + (1 - 2 * pad) * ((x[i]! - minX) / w);
    ny[i] = pad + (1 - 2 * pad) * ((y[i]! - minY) / h);
  }
  return { x: nx, y: ny };
}

export function decodeVectorsForLayout(
  packedEmbeddingsF32Base64: string,
  n: number,
  d: number,
): Float32Array {
  return decodePackedF32Base64(packedEmbeddingsF32Base64, n, d);
}

function runPca(rows: number[][]): { x: number[]; y: number[] } {
  if (rows.length < 2) {
    throw new Error("Need at least 2 points for PCA.");
  }
  const D = new druid.PCA(rows, {});
  const transformed = D.transform() as number[][];
  return xyFrom2D(transformed);
}

async function runUmap(
  rows: number[][],
): Promise<{ x: number[]; y: number[] }> {
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

export async function runGraphLayoutRequest(
  req: GraphLayoutRequest,
): Promise<GraphLayoutResponse> {
  const { id, packedEmbeddingsF32Base64, n, d, algorithm } = req;
  const metrics = createEmptyMetrics();
  try {
    const decodeStart = performance.now();
    const vectors = decodeVectorsForLayout(packedEmbeddingsF32Base64, n, d);
    metrics.decodeMs = performance.now() - decodeStart;
    if (n <= 0 || d <= 0 || vectors.length < n * d) {
      throw new Error("Invalid vector buffer.");
    }

    const rowStart = performance.now();
    const rows = rowsFromFlat(vectors, n, d);
    metrics.rowConversionMs = performance.now() - rowStart;

    const layoutStart = performance.now();
    let x: number[];
    let y: number[];
    if (algorithm === "pca") {
      ({ x, y } = runPca(rows));
    } else if (algorithm === "umap") {
      ({ x, y } = await runUmap(rows));
    } else {
      ({ x, y } = runTsne(rows));
    }
    metrics.layoutMs = performance.now() - layoutStart;

    const normalizeStart = performance.now();
    const normalized = normalizeCoords(x, y);
    metrics.normalizeMs = performance.now() - normalizeStart;

    return {
      id,
      ok: true,
      x: normalized.x,
      y: normalized.y,
      metrics,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { id, ok: false, error: msg };
  }
}

if (typeof self !== "undefined") {
  self.onmessage = async (ev: MessageEvent<GraphLayoutRequest>) => {
    const response = await runGraphLayoutRequest(ev.data);
    if (response.ok) {
      postMessage(response, [response.x.buffer, response.y.buffer]);
      return;
    }
    postMessage(response);
  };
}
