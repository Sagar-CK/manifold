"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBySourceIdAndPath = exports.attachEmbedding = exports.upsertMetadata = void 0;
var values_1 = require("convex/values");
var server_1 = require("./_generated/server");
var schema_1 = require("./schema");
exports.upsertMetadata = (0, server_1.mutation)({
    args: {
        sourceId: values_1.v.string(),
        path: values_1.v.string(),
        contentHash: values_1.v.string(),
        mtimeMs: values_1.v.number(),
        sizeBytes: values_1.v.number(),
        mimeType: values_1.v.string(),
        ext: values_1.v.string(),
    },
    handler: function (ctx, args) { return __awaiter(void 0, void 0, void 0, function () {
        var existing, _id;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, ctx.db
                        .query("files")
                        .withIndex("by_sourceId_and_path", function (q) {
                        return q.eq("sourceId", args.sourceId).eq("path", args.path);
                    })
                        .unique()];
                case 1:
                    existing = _a.sent();
                    if (!(existing === null)) return [3 /*break*/, 3];
                    return [4 /*yield*/, ctx.db.insert("files", {
                            sourceId: args.sourceId,
                            path: args.path,
                            contentHash: args.contentHash,
                            mtimeMs: args.mtimeMs,
                            sizeBytes: args.sizeBytes,
                            mimeType: args.mimeType,
                            ext: args.ext,
                        })];
                case 2:
                    _id = _a.sent();
                    return [2 /*return*/, _id];
                case 3: return [4 /*yield*/, ctx.db.patch(existing._id, {
                        contentHash: args.contentHash,
                        mtimeMs: args.mtimeMs,
                        sizeBytes: args.sizeBytes,
                        mimeType: args.mimeType,
                        ext: args.ext,
                    })];
                case 4:
                    _a.sent();
                    return [2 /*return*/, existing._id];
            }
        });
    }); },
});
exports.attachEmbedding = (0, server_1.mutation)({
    args: {
        sourceId: values_1.v.string(),
        fileId: values_1.v.id("files"),
        embedding: values_1.v.array(values_1.v.number()),
        dimensions: values_1.v.number(),
        model: values_1.v.string(),
    },
    handler: function (ctx, args) { return __awaiter(void 0, void 0, void 0, function () {
        var existing, embeddingId;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (args.model !== schema_1.EMBEDDING_MODEL) {
                        throw new Error("Unsupported embedding model: ".concat(args.model, ". Expected ").concat(schema_1.EMBEDDING_MODEL, "."));
                    }
                    if (args.dimensions !== schema_1.EMBEDDING_DIMENSIONS) {
                        throw new Error("Unsupported embedding dimensions: ".concat(args.dimensions, ". Expected ").concat(schema_1.EMBEDDING_DIMENSIONS, "."));
                    }
                    if (args.embedding.length !== schema_1.EMBEDDING_DIMENSIONS) {
                        throw new Error("Embedding length ".concat(args.embedding.length, " does not match expected dimensions ").concat(schema_1.EMBEDDING_DIMENSIONS, "."));
                    }
                    return [4 /*yield*/, ctx.db
                            .query("fileEmbeddings")
                            .withIndex("by_sourceId_and_fileId", function (q) {
                            return q.eq("sourceId", args.sourceId).eq("fileId", args.fileId);
                        })
                            .unique()];
                case 1:
                    existing = _a.sent();
                    if (!(existing === null)) return [3 /*break*/, 3];
                    return [4 /*yield*/, ctx.db.insert("fileEmbeddings", {
                            sourceId: args.sourceId,
                            fileId: args.fileId,
                            model: args.model,
                            dimensions: args.dimensions,
                            embedding: args.embedding,
                        })];
                case 2:
                    embeddingId = _a.sent();
                    return [3 /*break*/, 5];
                case 3:
                    embeddingId = existing._id;
                    return [4 /*yield*/, ctx.db.patch(existing._id, {
                            model: args.model,
                            dimensions: args.dimensions,
                            embedding: args.embedding,
                        })];
                case 4:
                    _a.sent();
                    _a.label = 5;
                case 5: return [4 /*yield*/, ctx.db.patch(args.fileId, { embeddingId: embeddingId })];
                case 6:
                    _a.sent();
                    return [2 /*return*/, embeddingId];
            }
        });
    }); },
});
exports.getBySourceIdAndPath = (0, server_1.internalQuery)({
    args: {
        sourceId: values_1.v.string(),
        path: values_1.v.string(),
    },
    handler: function (ctx, args) { return __awaiter(void 0, void 0, void 0, function () {
        var doc;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, ctx.db
                        .query("files")
                        .withIndex("by_sourceId_and_path", function (q) {
                        return q.eq("sourceId", args.sourceId).eq("path", args.path);
                    })
                        .unique()];
                case 1:
                    doc = _a.sent();
                    return [2 /*return*/, doc];
            }
        });
    }); },
});
