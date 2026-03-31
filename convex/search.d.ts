import { Id } from "./_generated/dataModel";
export declare const fetchFilesByIds: import("convex/server").RegisteredQuery<"internal", {
    ids: import("convex/values").GenericId<"files">[];
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
}[]>>;
export declare const semantic: import("convex/server").RegisteredAction<"public", {
    limit?: number;
    sourceId: string;
    queryVector: number[];
}, Promise<{
    score: number;
    file: {
        _id: import("convex/values").GenericId<"files">;
        path: string;
        mimeType: string;
        ext: string;
        mtimeMs: number;
        sizeBytes: number;
        extracted: {
            summary?: string;
            title?: string;
            keywords?: string[];
        };
    };
}[]>>;
export declare const fetchEmbeddings: import("convex/server").RegisteredQuery<"internal", {
    ids: import("convex/values").GenericId<"fileEmbeddings">[];
}, Promise<{
    _id: Id<"fileEmbeddings">;
    fileId: Id<"files">;
}[]>>;
