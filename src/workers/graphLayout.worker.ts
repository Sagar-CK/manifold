/// <reference lib="webworker" />

import { PCA } from "ml-pca";
import { UMAP } from "umap-js";
import tsnejs from "tsne";

export type GraphLayoutAlgorithm = "pca" | "umap" | "tsne";

export type GraphLayoutRequest = {
  vectors: Float32Array;
  n: number;
  d: number;
  algorithm: GraphLayoutAlgorithm;
};

export type GraphLayoutResponse =
  | { ok: true; x: Float64Array; y: Float64Array }
  | { ok: false; error: string };

function rowsFromFlat(vectors: Float32Array, n: number, d: number): number[][] {
  const rows: number[][] = [];
  for (let i = 0; i < n; i++) {
    const start = i * d;
    rows.push(Array.from(vectors.subarray(start, start + d)));
  }
  return rows;
}

function runPca(rows: number[][]): { x: number[]; y: number[] } {
  if (rows.length < 2) {
    throw new Error("Need at least 2 points for PCA.");
  }
  const pca = new PCA(rows);
  const proj = pca.predict(rows, { nComponents: 2 });
  const arr = proj.to2DArray();
  const x: number[] = [];
  const y: number[] = [];
  for (let i = 0; i < arr.length; i++) {
    x.push(arr[i][0] ?? 0);
    y.push(arr[i][1] ?? 0);
  }
  return { x, y };
}

async function runUmap(rows: number[][]): Promise<{ x: number[]; y: number[] }> {
  const n = rows.length;
  if (n < 2) {
    throw new Error("Need at least 2 points for UMAP.");
  }
  const nNeighbors = Math.min(15, Math.max(2, n - 1));
  const umap = new UMAP({
    nComponents: 2,
    nNeighbors,
    minDist: 0.1,
    spread: 1,
  });
  const embedding = await umap.fitAsync(rows);
  const x: number[] = [];
  const y: number[] = [];
  for (let i = 0; i < embedding.length; i++) {
    x.push(embedding[i][0] ?? 0);
    y.push(embedding[i][1] ?? 0);
  }
  return { x, y };
}

function runTsne(rows: number[][]): { x: number[]; y: number[] } {
  const n = rows.length;
  if (n < 2) {
    throw new Error("Need at least 2 points for t-SNE.");
  }
  const perplexity = Math.min(30, Math.max(5, n - 1));
  const model = new tsnejs.tSNE({ perplexity, dim: 2, epsilon: 10 });
  model.initDataRaw(rows);
  const steps = n > 200 ? 350 : 500;
  for (let s = 0; s < steps; s++) {
    model.step();
  }
  const sol = model.getSolution() as number[][];
  const x: number[] = [];
  const y: number[] = [];
  for (let i = 0; i < sol.length; i++) {
    x.push(sol[i][0] ?? 0);
    y.push(sol[i][1] ?? 0);
  }
  return { x, y };
}

self.onmessage = async (ev: MessageEvent<GraphLayoutRequest>) => {
  const { vectors, n, d, algorithm } = ev.data;
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
      ok: true,
      x: Float64Array.from(x),
      y: Float64Array.from(y),
    };
    postMessage(res, [res.x.buffer, res.y.buffer]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const res: GraphLayoutResponse = { ok: false, error: msg };
    postMessage(res);
  }
};
