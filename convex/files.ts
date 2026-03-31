import { v } from "convex/values";
import { internalQuery, mutation } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from "./schema";

export const upsertMetadata = mutation({
  args: {
    sourceId: v.string(),
    path: v.string(),
    contentHash: v.string(),
    mtimeMs: v.number(),
    sizeBytes: v.number(),
    mimeType: v.string(),
    ext: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("files")
      .withIndex("by_sourceId_and_path", (q) =>
        q.eq("sourceId", args.sourceId).eq("path", args.path),
      )
      .unique();

    if (existing === null) {
      const _id = await ctx.db.insert("files", {
        sourceId: args.sourceId,
        path: args.path,
        contentHash: args.contentHash,
        mtimeMs: args.mtimeMs,
        sizeBytes: args.sizeBytes,
        mimeType: args.mimeType,
        ext: args.ext,
      });
      return { fileId: _id, shouldEmbed: true };
    }

    const shouldEmbed = existing.contentHash !== args.contentHash || existing.embeddingId === undefined;
    await ctx.db.patch(existing._id, {
      contentHash: args.contentHash,
      mtimeMs: args.mtimeMs,
      sizeBytes: args.sizeBytes,
      mimeType: args.mimeType,
      ext: args.ext,
    });
    return { fileId: existing._id, shouldEmbed };
  },
});

export const attachEmbedding = mutation({
  args: {
    sourceId: v.string(),
    fileId: v.id("files"),
    embedding: v.array(v.number()),
    dimensions: v.number(),
    model: v.string(),
  },
  handler: async (ctx, args) => {
    if (args.model !== EMBEDDING_MODEL) {
      throw new Error(
        `Unsupported embedding model: ${args.model}. Expected ${EMBEDDING_MODEL}.`,
      );
    }
    if (args.dimensions !== EMBEDDING_DIMENSIONS) {
      throw new Error(
        `Unsupported embedding dimensions: ${args.dimensions}. Expected ${EMBEDDING_DIMENSIONS}.`,
      );
    }
    if (args.embedding.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(
        `Embedding length ${args.embedding.length} does not match expected dimensions ${EMBEDDING_DIMENSIONS}.`,
      );
    }

    const existing = await ctx.db
      .query("fileEmbeddings")
      .withIndex("by_sourceId_and_fileId", (q) =>
        q.eq("sourceId", args.sourceId).eq("fileId", args.fileId),
      )
      .unique();

    let embeddingId: Id<"fileEmbeddings">;
    if (existing === null) {
      embeddingId = await ctx.db.insert("fileEmbeddings", {
        sourceId: args.sourceId,
        fileId: args.fileId,
        model: args.model,
        dimensions: args.dimensions,
        embedding: args.embedding,
      });
    } else {
      embeddingId = existing._id;
      await ctx.db.patch(existing._id, {
        model: args.model,
        dimensions: args.dimensions,
        embedding: args.embedding,
      });
    }

    await ctx.db.patch(args.fileId, { embeddingId });
    return embeddingId;
  },
});

export const getBySourceIdAndPath = internalQuery({
  args: {
    sourceId: v.string(),
    path: v.string(),
  },
  handler: async (ctx, args) => {
    const doc: Doc<"files"> | null = await ctx.db
      .query("files")
      .withIndex("by_sourceId_and_path", (q) =>
        q.eq("sourceId", args.sourceId).eq("path", args.path),
      )
      .unique();
    return doc;
  },
});

