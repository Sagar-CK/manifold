import { v } from "convex/values";
import { action, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";
import { EMBEDDING_DIMENSIONS } from "./schema";

export const fetchFilesByIds = internalQuery({
  args: {
    ids: v.array(v.id("files")),
  },
  handler: async (ctx, args) => {
    const results: Array<Doc<"files">> = [];
    for (const id of args.ids) {
      const doc = await ctx.db.get(id);
      if (doc !== null) {
        results.push(doc);
      }
    }
    return results;
  },
});

export const semantic = action({
  args: {
    sourceId: v.string(),
    queryVector: v.array(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (args.queryVector.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(
        `Query vector length ${args.queryVector.length} does not match expected dimensions ${EMBEDDING_DIMENSIONS}.`,
      );
    }
    const limit = Math.max(1, Math.min(args.limit ?? 16, 256));

    const hits = await ctx.vectorSearch("fileEmbeddings", "by_embedding", {
      vector: args.queryVector,
      limit,
      filter: (q) => q.eq("sourceId", args.sourceId),
    });

    const embeddingDocs: Array<{
      _id: Id<"fileEmbeddings">;
      _score: number;
    }> = hits;

    const embeddingIds = embeddingDocs.map((h) => h._id);
    const embeddingRows = await ctx.runQuery(internal.search.fetchEmbeddings, {
      ids: embeddingIds,
    });

    const fileIds: Array<Id<"files">> = embeddingRows
      .map((row) => row?.fileId ?? null)
      .filter((x): x is Id<"files"> => x !== null);

    const files: Array<Doc<"files">> = await ctx.runQuery(
      internal.search.fetchFilesByIds,
      {
      ids: fileIds,
      },
    );

    const fileById = new Map<Id<"files">, Doc<"files">>();
    for (const f of files) fileById.set(f._id, f);

    const embeddingRowById = new Map<
      Id<"fileEmbeddings">,
      { fileId: Id<"files"> }
    >();
    for (const row of embeddingRows) {
      if (row) embeddingRowById.set(row._id, { fileId: row.fileId });
    }

    return embeddingDocs
      .map((h) => {
        const emb = embeddingRowById.get(h._id);
        if (!emb) return null;
        const file = fileById.get(emb.fileId);
        if (!file) return null;
        return {
          score: h._score,
          file: {
            _id: file._id,
            path: file.path,
            mimeType: file.mimeType,
            ext: file.ext,
            mtimeMs: file.mtimeMs,
            sizeBytes: file.sizeBytes,
            extracted: file.extracted ?? null,
          },
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  },
});

export const fetchEmbeddings = internalQuery({
  args: { ids: v.array(v.id("fileEmbeddings")) },
  handler: async (ctx, args) => {
    const out: Array<{ _id: Id<"fileEmbeddings">; fileId: Id<"files"> } | null> =
      [];
    for (const id of args.ids) {
      const doc = await ctx.db.get(id);
      if (doc === null) {
        out.push(null);
        continue;
      }
      out.push({ _id: doc._id, fileId: doc.fileId });
    }
    return out;
  },
});

