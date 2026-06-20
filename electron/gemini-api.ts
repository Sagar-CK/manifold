/**
 * Gemini Generative Language API (embed + OCR + judge).
 *
 * Use the runtime's global `fetch` (Node/Electron). Importing npm `undici` gets bundled into the
 * main process and often breaks outbound TLS (`TypeError: fetch failed` with no useful cause).
 */

import {
  averageEmbeddings,
  GEMINI_PDF_CHUNK_PAGES,
  GEMINI_PDF_MAX_PAGES,
  isGeminiPdfPageLimitError,
  splitPdfBytes,
} from "./pdf-split.js";
import {
  extractPdfTextAllPages,
  extractPdfTextPageRange,
  getPdfPageCount,
} from "./pdf-document.js";
import { getGeminiApiKey } from "./gemini-key-store.js";

function formatNetworkError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const parts: string[] = [err.message];
  let c: unknown = err.cause;
  for (let i = 0; i < 6 && c instanceof Error; i += 1) {
    parts.push(`cause: ${c.message}`);
    c = c.cause;
  }
  return parts.join(" | ");
}

export const OUTPUT_DIM = 3072;
export const GEMINI_MODEL = "models/gemini-embedding-2-preview";
export const GEMINI_OCR_MODEL = "models/gemini-3-flash-preview";
const EMBED_TIMEOUT_MS = 120_000;
const OCR_TIMEOUT_MS = 180_000;
const MAX_ATTEMPTS = 5;

function l2Normalize(v: number[]): number[] {
  let sum = 0;
  for (const x of v) sum += x * x;
  const norm = Math.sqrt(sum);
  if (norm === 0) return v;
  for (let i = 0; i < v.length; i++) v[i] /= norm;
  return v;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

type GeminiEmbedResponse = {
  embedding?: { values?: number[] };
  embeddings?: Array<{ values?: number[] }>;
};

export async function readGeminiApiKeyOrThrow(): Promise<string> {
  const key = await getGeminiApiKey();
  if (!key) {
    throw new Error(
      "Missing Gemini API key. Save a key in Settings → General.",
    );
  }
  return key;
}

async function geminiEmbedPost(
  apiKey: string,
  body: unknown,
): Promise<number[]> {
  const url = `https://generativelanguage.googleapis.com/v1beta/${GEMINI_MODEL}:embedContent`;
  let attempt = 0;
  let backoff = 400;
  while (attempt < MAX_ATTEMPTS) {
    attempt += 1;
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), EMBED_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      clearTimeout(t);
      if (res.ok) {
        const json = (await res.json()) as GeminiEmbedResponse;
        const values =
          json.embedding?.values ??
          (json.embeddings?.length
            ? json.embeddings[json.embeddings.length - 1]?.values
            : undefined);
        if (!values || values.length !== OUTPUT_DIM) {
          throw new Error(
            `Gemini embedContent returned ${values?.length ?? 0} floats; expected ${OUTPUT_DIM}`,
          );
        }
        return l2Normalize(values.map(Number));
      }
      const text = await res.text();
      const retryable =
        res.status === 429 || res.status === 500 || res.status === 503;
      if (!retryable || attempt >= MAX_ATTEMPTS) {
        throw new Error(
          `Gemini embedContent failed (HTTP ${res.status}): ${text}`,
        );
      }
    } catch (e) {
      clearTimeout(t);
      if (attempt >= MAX_ATTEMPTS) {
        throw new Error(formatNetworkError(e), {
          cause: e instanceof Error ? e : undefined,
        });
      }
    }
    await sleep(backoff);
    backoff = Math.min(5000, Math.round(backoff * 1.8));
  }
  throw new Error("Gemini embedContent: max attempts exceeded");
}

export async function embedQueryText(
  apiKey: string,
  text: string,
): Promise<number[]> {
  return geminiEmbedPost(apiKey, {
    content: { parts: [{ text }] },
    output_dimensionality: OUTPUT_DIM,
  });
}

export async function embedMultimodal(
  apiKey: string,
  mimeType: string,
  bytes: Uint8Array,
): Promise<number[]> {
  if (mimeType !== "application/pdf") {
    return embedMultimodalSingle(apiKey, mimeType, bytes);
  }
  return embedPdfMultimodal(apiKey, bytes);
}

async function embedMultimodalSingle(
  apiKey: string,
  mimeType: string,
  bytes: Uint8Array,
): Promise<number[]> {
  const b64 = Buffer.from(bytes).toString("base64");
  return geminiEmbedPost(apiKey, {
    content: {
      parts: [
        {
          inline_data: {
            mime_type: mimeType,
            data: b64,
          },
        },
      ],
    },
    output_dimensionality: OUTPUT_DIM,
  });
}

const PDF_TEXT_PAGES_PER_CHUNK = 200;
const PDF_TEXT_EMBED_MAX_CHARS = 24_000;
const PDF_TEXT_MIN_NONSPACE = 32;

async function embedPdfFromExtractedText(
  apiKey: string,
  bytes: Uint8Array,
): Promise<number[]> {
  const pageCount = await getPdfPageCount(bytes);
  const vectors: number[][] = [];
  for (let start = 1; start <= pageCount; start += PDF_TEXT_PAGES_PER_CHUNK) {
    const end = Math.min(start + PDF_TEXT_PAGES_PER_CHUNK - 1, pageCount);
    const text = await extractPdfTextPageRange(bytes, start, end);
    const nonspace = [...text].filter((c) => !/\s/.test(c)).length;
    if (nonspace < PDF_TEXT_MIN_NONSPACE) continue;
    const capped =
      text.length > PDF_TEXT_EMBED_MAX_CHARS
        ? text.slice(0, PDF_TEXT_EMBED_MAX_CHARS)
        : text;
    vectors.push(await embedQueryText(apiKey, capped));
  }
  if (vectors.length === 0) {
    throw new Error("No extractable text found in PDF for embedding");
  }
  return averageEmbeddings(vectors);
}

async function embedPdfBinaryChunks(
  apiKey: string,
  bytes: Uint8Array,
): Promise<number[]> {
  const chunks = await splitPdfBytes(bytes, GEMINI_PDF_CHUNK_PAGES);
  const vectors: number[][] = [];
  for (const chunk of chunks) {
    vectors.push(
      await embedMultimodalSingle(apiKey, "application/pdf", chunk),
    );
  }
  return averageEmbeddings(vectors);
}

async function embedPdfMultimodal(
  apiKey: string,
  bytes: Uint8Array,
): Promise<number[]> {
  let pageCount = GEMINI_PDF_MAX_PAGES + 1;
  try {
    pageCount = await getPdfPageCount(bytes);
  } catch {
    // If page count fails, try a single request then split on page-limit errors.
  }

  if (pageCount <= GEMINI_PDF_MAX_PAGES) {
    try {
      return await embedMultimodalSingle(apiKey, "application/pdf", bytes);
    } catch (e) {
      if (!isGeminiPdfPageLimitError(String(e))) throw e;
    }
  }

  // Large PDFs: prefer pdf.js text chunks (pdf-lib often fails on complex files).
  try {
    return await embedPdfFromExtractedText(apiKey, bytes);
  } catch {
    // Fall through to binary split when there is little extractable text.
  }

  try {
    return await embedPdfBinaryChunks(apiKey, bytes);
  } catch (binaryErr) {
    try {
      return await embedPdfFromExtractedText(apiKey, bytes);
    } catch {
      throw binaryErr;
    }
  }
}

function parseGenerateContentPlainText(responseBody: string): string {
  const v = JSON.parse(responseBody) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>;
  };
  const parts =
    v.candidates?.[0]?.content?.parts?.filter(
      (p): p is { text: string } => typeof p.text === "string",
    ) ?? [];
  return parts.map((p) => p.text).join("\n");
}

const OCR_ATTEMPTS = 5;

export async function extractTextWithGemini(
  apiKey: string,
  filePath: string,
  mimeType: string,
  bytes: Uint8Array,
): Promise<string> {
  if (mimeType === "application/pdf") {
    return extractPdfTextWithGemini(apiKey, filePath, bytes);
  }
  return extractTextWithGeminiSingle(apiKey, filePath, mimeType, bytes);
}

async function extractPdfTextWithGemini(
  apiKey: string,
  filePath: string,
  bytes: Uint8Array,
): Promise<string> {
  let pageCount = GEMINI_PDF_MAX_PAGES + 1;
  try {
    pageCount = await getPdfPageCount(bytes);
  } catch {
    // fall through to single attempt / split-on-error
  }

  if (pageCount <= GEMINI_PDF_MAX_PAGES) {
    try {
      return await extractTextWithGeminiSingle(
        apiKey,
        filePath,
        "application/pdf",
        bytes,
      );
    } catch (e) {
      if (!isGeminiPdfPageLimitError(String(e))) throw e;
    }
  }

  const pdfjsText = await extractPdfTextAllPages(bytes);
  if (
    [...pdfjsText].filter((c) => !/\s/.test(c)).length >= PDF_TEXT_MIN_NONSPACE
  ) {
    return pdfjsText;
  }

  try {
    const chunks = await splitPdfBytes(bytes, GEMINI_PDF_CHUNK_PAGES);
    const parts: string[] = [];
    for (const chunk of chunks) {
      const text = await extractTextWithGeminiSingle(
        apiKey,
        filePath,
        "application/pdf",
        chunk,
      );
      if (text.trim()) parts.push(text.trim());
    }
    if (parts.length > 0) return parts.join("\n\n");
  } catch {
    // pdf-lib could not split — return any pdf.js text we already have
  }

  if (pdfjsText.trim()) return pdfjsText;
  throw new Error(`Could not extract text from large PDF: ${filePath}`);
}

async function extractTextWithGeminiSingle(
  apiKey: string,
  filePath: string,
  mimeType: string,
  bytes: Uint8Array,
): Promise<string> {
  const b64 = Buffer.from(bytes).toString("base64");
  const body = {
    contents: [
      {
        parts: [
          {
            text: "Extract all readable text from this file and return plain text only. Do not add explanations, labels, markdown, or commentary.",
          },
          { inline_data: { mime_type: mimeType, data: b64 } },
        ],
      },
    ],
    generationConfig: {
      temperature: 0,
      responseMimeType: "text/plain",
    },
  };
  const url = `https://generativelanguage.googleapis.com/v1beta/${GEMINI_OCR_MODEL}:generateContent`;
  let attempt = 0;
  let backoff = 800;
  while (attempt < OCR_ATTEMPTS) {
    attempt += 1;
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), OCR_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      clearTimeout(t);
      const text = await res.text();
      if (res.ok) return parseGenerateContentPlainText(text);
      const retryable =
        res.status === 429 || res.status === 500 || res.status === 503;
      if (!retryable || attempt >= OCR_ATTEMPTS) {
        throw new Error(
          `Gemini text extraction failed for ${filePath} (HTTP ${res.status}): ${text}`,
        );
      }
    } catch (e) {
      clearTimeout(t);
      if (attempt >= OCR_ATTEMPTS) {
        throw new Error(formatNetworkError(e), {
          cause: e instanceof Error ? e : undefined,
        });
      }
    }
    await sleep(backoff);
    backoff = Math.min(6000, Math.round(backoff * 1.8));
  }
  throw new Error("Gemini text extraction: max attempts exceeded");
}

export type GeminiContentPart =
  | { text: string }
  | { inline_data: { mime_type: string; data: string } };

export async function judgeTag(
  apiKey: string,
  params: {
    tagName: string;
    similarityScore: number;
    sourcePath: string;
    targetPath: string;
    sourcePart: unknown;
    targetPart: unknown;
  },
): Promise<boolean> {
  const prompt = `You are evaluating if two files belong to the same category/tag based on their content. The tag is: '${params.tagName}'. The embedding cosine similarity score between these two files is ${params.similarityScore} (higher is more similar). Do these files both belong to the tag '${params.tagName}'? Answer strictly YES or NO.`;
  const body = {
    contents: [
      {
        parts: [
          { text: prompt },
          { text: "File 1:" },
          params.sourcePart,
          { text: "File 2:" },
          params.targetPart,
        ] as unknown[],
      },
    ],
    generationConfig: {
      temperature: 0,
      responseMimeType: "text/plain",
    },
  };
  const url = `https://generativelanguage.googleapis.com/v1beta/${GEMINI_OCR_MODEL}:generateContent`;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 60_000);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify(body),
    signal: ac.signal,
  });
  clearTimeout(t);
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`Gemini judge tag failed (HTTP ${res.status}): ${raw}`);
  }
  const json = JSON.parse(raw) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text =
    json.candidates?.[0]?.content?.parts?.[0]?.text?.trim().toUpperCase() ?? "";
  return text.includes("YES");
}

/** @internal LRU for query embeddings (optional; embedding-job may pass apiKey each time). */
const queryCache = new Map<string, number[]>();
const QUERY_CACHE_MAX = 128;

function trimQueryCache(): void {
  while (queryCache.size > QUERY_CACHE_MAX) {
    const first = queryCache.keys().next().value;
    if (first === undefined) break;
    queryCache.delete(first);
  }
}

export async function embedQueryTextCached(
  apiKey: string,
  text: string,
): Promise<number[]> {
  const hit = queryCache.get(text);
  if (hit) return hit;
  const v = await embedQueryText(apiKey, text);
  queryCache.set(text, v);
  trimQueryCache();
  return v;
}

export function clearGeminiQueryCache(): void {
  queryCache.clear();
}
