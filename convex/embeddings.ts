"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { GoogleGenAI } from "@google/genai";

declare const process: { env: Record<string, string | undefined> };

const MODEL = "gemini-embedding-2-preview";
const OUTPUT_DIM = 768 as const;

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

async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 5): Promise<T> {
  let attempt = 0;
  let backoffMs = 400;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    attempt += 1;
    try {
      return await fn();
    } catch (err) {
      if (attempt >= maxAttempts) throw err;
      await sleep(backoffMs);
      backoffMs = Math.min(5000, Math.round(backoffMs * 1.8));
    }
  }
}

function getApiKey(): string {
  const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? "";
  if (!key) {
    throw new Error("Missing Convex env var GOOGLE_GENERATIVE_AI_API_KEY.");
  }
  return key;
}

export const embed = action({
  args: {
    input: v.union(
      v.object({
        kind: v.literal("text"),
        text: v.string(),
      }),
      v.object({
        kind: v.literal("inlineData"),
        mimeType: v.string(),
        base64Data: v.string(),
      }),
    ),
  },
  handler: async (_ctx, args) => {
    const apiKey = getApiKey();
    const ai = new GoogleGenAI({ apiKey });
    const input = args.input;

    if (input.kind === "text") {
      const res = await withRetry(() =>
        ai.models.embedContent({
          model: MODEL,
          contents: input.text,
          config: { outputDimensionality: OUTPUT_DIM },
        }),
      );
      const values = res.embeddings?.[0]?.values ?? null;
      if (!values || values.length !== OUTPUT_DIM) {
        throw new Error(`Unexpected embedding response; expected ${OUTPUT_DIM} floats.`);
      }
      return l2Normalize(values);
    }

    const res = await withRetry(() =>
      ai.models.embedContent({
        model: MODEL,
        contents: [
          {
            inlineData: {
              mimeType: input.mimeType,
              data: input.base64Data,
            },
          },
        ],
        config: { outputDimensionality: OUTPUT_DIM },
      }),
    );
    const values = res.embeddings?.[0]?.values ?? null;
    if (!values || values.length !== OUTPUT_DIM) {
      throw new Error(`Unexpected embedding response; expected ${OUTPUT_DIM} floats.`);
    }
    return l2Normalize(values);
  },
});

