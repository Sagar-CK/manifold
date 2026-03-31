import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const EMBEDDING_MODEL = "gemini-embedding-2-preview";
export const EMBEDDING_DIMENSIONS = 768 as const;

export default defineSchema({
  files: defineTable({
    sourceId: v.string(),
    path: v.string(),
    contentHash: v.string(),
    mtimeMs: v.number(),
    sizeBytes: v.number(),
    mimeType: v.string(),
    ext: v.string(),
    embeddingId: v.optional(v.id("fileEmbeddings")),
    extracted: v.optional(
      v.object({
        title: v.optional(v.string()),
        summary: v.optional(v.string()),
        keywords: v.optional(v.array(v.string())),
      }),
    ),
  })
    .index("by_sourceId_and_path", ["sourceId", "path"])
    .index("by_sourceId_and_contentHash", ["sourceId", "contentHash"]),

  fileEmbeddings: defineTable({
    sourceId: v.string(),
    fileId: v.id("files"),
    model: v.string(),
    dimensions: v.number(),
    embedding: v.array(v.float64()),
  })
    .index("by_sourceId_and_fileId", ["sourceId", "fileId"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: EMBEDDING_DIMENSIONS,
      filterFields: ["sourceId"],
    }),
});

