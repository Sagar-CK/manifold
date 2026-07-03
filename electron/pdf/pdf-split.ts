import { PDFDocument } from "pdf-lib";

/** Gemini embedContent PDF limit (pages). */
export const GEMINI_PDF_MAX_PAGES = 1000;

/** Stay under the API limit when splitting multi-part PDFs. */
export const GEMINI_PDF_CHUNK_PAGES = 900;

export function isGeminiPdfPageLimitError(message: string): boolean {
  return (
    message.includes("exceeds the supported page limit") ||
    message.includes("page limit of 1000")
  );
}

function l2Normalize(v: number[]): number[] {
  let sum = 0;
  for (const x of v) sum += x * x;
  const norm = Math.sqrt(sum);
  if (norm === 0) return v;
  for (let i = 0; i < v.length; i++) v[i] /= norm;
  return v;
}

/** Mean-pool chunk embeddings, then L2-normalize (Gemini vectors are unit length). */
export function averageEmbeddings(vectors: number[][]): number[] {
  if (vectors.length === 0) {
    throw new Error("averageEmbeddings: empty input");
  }
  if (vectors.length === 1) return vectors[0];
  const dim = vectors[0].length;
  const sum = new Array<number>(dim).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) sum[i] += v[i];
  }
  for (let i = 0; i < dim; i++) sum[i] /= vectors.length;
  return l2Normalize(sum);
}

/** Split a PDF into page-bounded chunks suitable for Gemini embedding / OCR. */
export async function splitPdfBytes(
  bytes: Uint8Array,
  maxPagesPerChunk: number = GEMINI_PDF_CHUNK_PAGES,
): Promise<Uint8Array[]> {
  const input = new Uint8Array(bytes);
  const src = await PDFDocument.load(input, { ignoreEncryption: true });
  const total = src.getPageCount();
  if (total <= maxPagesPerChunk) return [input];

  const chunks: Uint8Array[] = [];
  for (let start = 0; start < total; start += maxPagesPerChunk) {
    const end = Math.min(start + maxPagesPerChunk, total);
    const dst = await PDFDocument.create();
    const indices = Array.from({ length: end - start }, (_, i) => start + i);
    const pages = await dst.copyPages(src, indices);
    for (const page of pages) dst.addPage(page);
    chunks.push(await dst.save());
  }
  return chunks;
}
