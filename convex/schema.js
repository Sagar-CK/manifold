"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EMBEDDING_DIMENSIONS = exports.EMBEDDING_MODEL = void 0;
var server_1 = require("convex/server");
var values_1 = require("convex/values");
exports.EMBEDDING_MODEL = "gemini-embedding-2-preview";
exports.EMBEDDING_DIMENSIONS = 768;
exports.default = (0, server_1.defineSchema)({
    files: (0, server_1.defineTable)({
        sourceId: values_1.v.string(),
        path: values_1.v.string(),
        contentHash: values_1.v.string(),
        mtimeMs: values_1.v.number(),
        sizeBytes: values_1.v.number(),
        mimeType: values_1.v.string(),
        ext: values_1.v.string(),
        embeddingId: values_1.v.optional(values_1.v.id("fileEmbeddings")),
        extracted: values_1.v.optional(values_1.v.object({
            title: values_1.v.optional(values_1.v.string()),
            summary: values_1.v.optional(values_1.v.string()),
            keywords: values_1.v.optional(values_1.v.array(values_1.v.string())),
        })),
    })
        .index("by_sourceId_and_path", ["sourceId", "path"])
        .index("by_sourceId_and_contentHash", ["sourceId", "contentHash"]),
    fileEmbeddings: (0, server_1.defineTable)({
        sourceId: values_1.v.string(),
        fileId: values_1.v.id("files"),
        model: values_1.v.string(),
        dimensions: values_1.v.number(),
        embedding: values_1.v.array(values_1.v.float64()),
    })
        .index("by_sourceId_and_fileId", ["sourceId", "fileId"])
        .vectorIndex("by_embedding", {
        vectorField: "embedding",
        dimensions: exports.EMBEDDING_DIMENSIONS,
        filterFields: ["sourceId"],
    }),
});
