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
exports.fetchEmbeddings = exports.semantic = exports.fetchFilesByIds = void 0;
var values_1 = require("convex/values");
var server_1 = require("./_generated/server");
var api_1 = require("./_generated/api");
var schema_1 = require("./schema");
exports.fetchFilesByIds = (0, server_1.internalQuery)({
    args: {
        ids: values_1.v.array(values_1.v.id("files")),
    },
    handler: function (ctx, args) { return __awaiter(void 0, void 0, void 0, function () {
        var results, _i, _a, id, doc;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    results = [];
                    _i = 0, _a = args.ids;
                    _b.label = 1;
                case 1:
                    if (!(_i < _a.length)) return [3 /*break*/, 4];
                    id = _a[_i];
                    return [4 /*yield*/, ctx.db.get(id)];
                case 2:
                    doc = _b.sent();
                    if (doc !== null) {
                        results.push(doc);
                    }
                    _b.label = 3;
                case 3:
                    _i++;
                    return [3 /*break*/, 1];
                case 4: return [2 /*return*/, results];
            }
        });
    }); },
});
exports.semantic = (0, server_1.action)({
    args: {
        sourceId: values_1.v.string(),
        queryVector: values_1.v.array(values_1.v.number()),
        limit: values_1.v.optional(values_1.v.number()),
    },
    handler: function (ctx, args) { return __awaiter(void 0, void 0, void 0, function () {
        var limit, hits, embeddingDocs, embeddingIds, embeddingRows, fileIds, files, fileById, _i, files_1, f, embeddingRowById, _a, embeddingRows_1, row;
        var _b;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    if (args.queryVector.length !== schema_1.EMBEDDING_DIMENSIONS) {
                        throw new Error("Query vector length ".concat(args.queryVector.length, " does not match expected dimensions ").concat(schema_1.EMBEDDING_DIMENSIONS, "."));
                    }
                    limit = Math.max(1, Math.min((_b = args.limit) !== null && _b !== void 0 ? _b : 16, 256));
                    return [4 /*yield*/, ctx.vectorSearch("fileEmbeddings", "by_embedding", {
                            vector: args.queryVector,
                            limit: limit,
                            filter: function (q) { return q.eq("sourceId", args.sourceId); },
                        })];
                case 1:
                    hits = _c.sent();
                    embeddingDocs = hits;
                    embeddingIds = embeddingDocs.map(function (h) { return h._id; });
                    return [4 /*yield*/, ctx.runQuery(api_1.internal.search.fetchEmbeddings, {
                            ids: embeddingIds,
                        })];
                case 2:
                    embeddingRows = _c.sent();
                    fileIds = embeddingRows
                        .map(function (row) { var _a; return (_a = row === null || row === void 0 ? void 0 : row.fileId) !== null && _a !== void 0 ? _a : null; })
                        .filter(function (x) { return x !== null; });
                    return [4 /*yield*/, ctx.runQuery(api_1.internal.search.fetchFilesByIds, {
                            ids: fileIds,
                        })];
                case 3:
                    files = _c.sent();
                    fileById = new Map();
                    for (_i = 0, files_1 = files; _i < files_1.length; _i++) {
                        f = files_1[_i];
                        fileById.set(f._id, f);
                    }
                    embeddingRowById = new Map();
                    for (_a = 0, embeddingRows_1 = embeddingRows; _a < embeddingRows_1.length; _a++) {
                        row = embeddingRows_1[_a];
                        if (row)
                            embeddingRowById.set(row._id, { fileId: row.fileId });
                    }
                    return [2 /*return*/, embeddingDocs
                            .map(function (h) {
                            var _a;
                            var emb = embeddingRowById.get(h._id);
                            if (!emb)
                                return null;
                            var file = fileById.get(emb.fileId);
                            if (!file)
                                return null;
                            return {
                                score: h._score,
                                file: {
                                    _id: file._id,
                                    path: file.path,
                                    mimeType: file.mimeType,
                                    ext: file.ext,
                                    mtimeMs: file.mtimeMs,
                                    sizeBytes: file.sizeBytes,
                                    extracted: (_a = file.extracted) !== null && _a !== void 0 ? _a : null,
                                },
                            };
                        })
                            .filter(function (x) { return x !== null; })];
            }
        });
    }); },
});
exports.fetchEmbeddings = (0, server_1.internalQuery)({
    args: { ids: values_1.v.array(values_1.v.id("fileEmbeddings")) },
    handler: function (ctx, args) { return __awaiter(void 0, void 0, void 0, function () {
        var out, _i, _a, id, doc;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    out = [];
                    _i = 0, _a = args.ids;
                    _b.label = 1;
                case 1:
                    if (!(_i < _a.length)) return [3 /*break*/, 4];
                    id = _a[_i];
                    return [4 /*yield*/, ctx.db.get(id)];
                case 2:
                    doc = _b.sent();
                    if (doc === null) {
                        out.push(null);
                        return [3 /*break*/, 3];
                    }
                    out.push({ _id: doc._id, fileId: doc.fileId });
                    _b.label = 3;
                case 3:
                    _i++;
                    return [3 /*break*/, 1];
                case 4: return [2 /*return*/, out];
            }
        });
    }); },
});
