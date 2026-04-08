import { describe, expect, it } from "vitest";
import { decodePackedF32Base64 } from "@/lib/packedEmbeddings";
import {
  decodeVectorsForLayout,
  runGraphLayoutRequest,
} from "@/workers/graphLayout.worker";

function encodeFloat32Base64(values: number[]): string {
  const floats = Float32Array.from(values);
  const bytes = new Uint8Array(floats.buffer);
  return Buffer.from(bytes).toString("base64");
}

describe("graphLayout worker helpers", () => {
  it("decodes packed embeddings the same way as the existing base64 decoder", () => {
    const packed = encodeFloat32Base64([0.5, -1.25, 9.75, 3.5]);

    expect(Array.from(decodeVectorsForLayout(packed, 2, 2))).toEqual(
      Array.from(decodePackedF32Base64(packed, 2, 2)),
    );
  });

  it("returns normalized coordinates from the worker request helper", async () => {
    const packed = encodeFloat32Base64([1, 0, 0, 1, 1, 1]);

    const response = await runGraphLayoutRequest({
      id: 7,
      packedEmbeddingsF32Base64: packed,
      n: 3,
      d: 2,
      algorithm: "pca",
    });

    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.x).toHaveLength(3);
    expect(response.y).toHaveLength(3);
    for (const value of response.x) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
    for (const value of response.y) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
    expect(response.metrics.decodeMs).toBeGreaterThanOrEqual(0);
  });
});
