import { idbGet, idbSet } from "./idb";

const MODEL = "models/gemini-embedding-2-preview";
export const OUTPUT_DIM = 768 as const;

type EmbedResponse = {
  embeddings?: Array<{ values: number[] }>;
  embedding?: { values: number[] };
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function l2Normalize(vec: number[]): number[] {
  let sumSq = 0;
  for (const x of vec) sumSq += x * x;
  const norm = Math.sqrt(sumSq);
  if (norm === 0) return vec;
  return vec.map((x) => x / norm);
}

async function fetchWithRetry(
  input: RequestInfo | URL,
  init: RequestInit,
  maxAttempts = 5,
): Promise<Response> {
  let attempt = 0;
  let backoffMs = 400;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    attempt += 1;
    const res = await fetch(input, init);
    if (res.ok) return res;
    if (attempt >= maxAttempts) return res;
    if (res.status === 429 || res.status === 500 || res.status === 503) {
      await sleep(backoffMs);
      backoffMs = Math.min(5000, Math.round(backoffMs * 1.8));
      continue;
    }
    return res;
  }
}

async function embedContentRaw(
  apiKey: string,
  content: unknown,
): Promise<number[]> {
  const res = await fetchWithRetry(
    `https://generativelanguage.googleapis.com/v1beta/${MODEL}:embedContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        content,
        output_dimensionality: OUTPUT_DIM,
      }),
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Gemini embedContent failed (${res.status}): ${text}`);
  }
  const json = (await res.json()) as EmbedResponse;
  const values =
    json.embedding?.values ??
    json.embeddings?.[0]?.values ??
    null;
  if (!values || values.length !== OUTPUT_DIM) {
    throw new Error(
      `Unexpected embedding response; expected ${OUTPUT_DIM} floats.`,
    );
  }
  // Gemini docs: non-3072 embeddings should be normalized.
  return l2Normalize(values);
}

export async function embedText(apiKey: string, text: string): Promise<number[]> {
  return await embedContentRaw(apiKey, { parts: [{ text }] });
}

export async function embedInlineData(
  apiKey: string,
  params: { mimeType: string; base64Data: string },
): Promise<number[]> {
  return await embedContentRaw(apiKey, {
    parts: [
      {
        inline_data: {
          mime_type: params.mimeType,
          data: params.base64Data,
        },
      },
    ],
  });
}

export async function cachedEmbedding(
  cacheKey: string,
  compute: () => Promise<number[]>,
): Promise<number[]> {
  const cached = await idbGet<number[]>(cacheKey);
  if (cached && cached.length === OUTPUT_DIM) return cached;
  const fresh = await compute();
  await idbSet(cacheKey, fresh);
  return fresh;
}

