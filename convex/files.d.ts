import { Id } from "./_generated/dataModel";
export declare const upsertMetadata: import("convex/server").RegisteredMutation<"public", {
    path: string;
    sourceId: string;
    contentHash: string;
    mtimeMs: number;
    sizeBytes: number;
    mimeType: string;
    ext: string;
}, Promise<import("convex/values").GenericId<"files">>>;
export declare const attachEmbedding: import("convex/server").RegisteredMutation<"public", {
    dimensions: number;
    sourceId: string;
    fileId: import("convex/values").GenericId<"files">;
    model: string;
    embedding: number[];
}, Promise<Id<"fileEmbeddings">>>;
export declare const getBySourceIdAndPath: import("convex/server").RegisteredQuery<"internal", {
    path: string;
    sourceId: string;
}, Promise<{
    _id: import("convex/values").GenericId<"files">;
    _creationTime: number;
    embeddingId?: import("convex/values").GenericId<"fileEmbeddings">;
    extracted?: {
        summary?: string;
        title?: string;
        keywords?: string[];
    };
    path: string;
    sourceId: string;
    contentHash: string;
    mtimeMs: number;
    sizeBytes: number;
    mimeType: string;
    ext: string;
}>>;
