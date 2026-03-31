export declare const EMBEDDING_MODEL = "gemini-embedding-2-preview";
export declare const EMBEDDING_DIMENSIONS: 768;
declare const _default: import("convex/server").SchemaDefinition<{
    files: import("convex/server").TableDefinition<import("convex/values").VObject<{
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
    }, {
        sourceId: import("convex/values").VString<string, "required">;
        path: import("convex/values").VString<string, "required">;
        contentHash: import("convex/values").VString<string, "required">;
        mtimeMs: import("convex/values").VFloat64<number, "required">;
        sizeBytes: import("convex/values").VFloat64<number, "required">;
        mimeType: import("convex/values").VString<string, "required">;
        ext: import("convex/values").VString<string, "required">;
        embeddingId: import("convex/values").VId<import("convex/values").GenericId<"fileEmbeddings">, "optional">;
        extracted: import("convex/values").VObject<{
            summary?: string;
            title?: string;
            keywords?: string[];
        }, {
            title: import("convex/values").VString<string, "optional">;
            summary: import("convex/values").VString<string, "optional">;
            keywords: import("convex/values").VArray<string[], import("convex/values").VString<string, "required">, "optional">;
        }, "optional", "summary" | "title" | "keywords">;
    }, "required", "path" | "sourceId" | "contentHash" | "mtimeMs" | "sizeBytes" | "mimeType" | "ext" | "embeddingId" | "extracted" | "extracted.summary" | "extracted.title" | "extracted.keywords">, {
        by_sourceId_and_path: ["sourceId", "path", "_creationTime"];
        by_sourceId_and_contentHash: ["sourceId", "contentHash", "_creationTime"];
    }, {}, {}>;
    fileEmbeddings: import("convex/server").TableDefinition<import("convex/values").VObject<{
        dimensions: number;
        sourceId: string;
        fileId: import("convex/values").GenericId<"files">;
        model: string;
        embedding: number[];
    }, {
        sourceId: import("convex/values").VString<string, "required">;
        fileId: import("convex/values").VId<import("convex/values").GenericId<"files">, "required">;
        model: import("convex/values").VString<string, "required">;
        dimensions: import("convex/values").VFloat64<number, "required">;
        embedding: import("convex/values").VArray<number[], import("convex/values").VFloat64<number, "required">, "required">;
    }, "required", "dimensions" | "sourceId" | "fileId" | "model" | "embedding">, {
        by_sourceId_and_fileId: ["sourceId", "fileId", "_creationTime"];
    }, {}, {
        by_embedding: {
            vectorField: "embedding";
            dimensions: number;
            filterFields: "sourceId";
        };
    }>;
}, true>;
export default _default;
