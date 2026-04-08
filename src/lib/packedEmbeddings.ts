export function decodePackedF32Base64(
  b64: string,
  n: number,
  d: number,
): Float32Array {
  if (n === 0 || d === 0) {
    return new Float32Array();
  }
  const bin = atob(b64);
  const buf = new ArrayBuffer(bin.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) {
    view[i] = bin.charCodeAt(i);
  }
  const out = new Float32Array(buf);
  if (out.length !== n * d) {
    throw new Error(
      `packed embedding size mismatch: expected ${n * d} floats, got ${out.length}`,
    );
  }
  return out;
}
