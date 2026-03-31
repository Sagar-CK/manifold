"use node";
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
exports.embed = void 0;
var values_1 = require("convex/values");
var server_1 = require("./_generated/server");
var genai_1 = require("@google/genai");
var MODEL = "gemini-embedding-2-preview";
var OUTPUT_DIM = 768;
function sleep(ms) {
    return new Promise(function (r) { return setTimeout(r, ms); });
}
function l2Normalize(vec) {
    var sumSq = 0;
    for (var _i = 0, vec_1 = vec; _i < vec_1.length; _i++) {
        var x = vec_1[_i];
        sumSq += x * x;
    }
    var norm = Math.sqrt(sumSq);
    if (norm === 0)
        return vec;
    return vec.map(function (x) { return x / norm; });
}
function withRetry(fn_1) {
    return __awaiter(this, arguments, void 0, function (fn, maxAttempts) {
        var attempt, backoffMs, err_1;
        if (maxAttempts === void 0) { maxAttempts = 5; }
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    attempt = 0;
                    backoffMs = 400;
                    _a.label = 1;
                case 1:
                    if (!true) return [3 /*break*/, 7];
                    attempt += 1;
                    _a.label = 2;
                case 2:
                    _a.trys.push([2, 4, , 6]);
                    return [4 /*yield*/, fn()];
                case 3: return [2 /*return*/, _a.sent()];
                case 4:
                    err_1 = _a.sent();
                    if (attempt >= maxAttempts)
                        throw err_1;
                    return [4 /*yield*/, sleep(backoffMs)];
                case 5:
                    _a.sent();
                    backoffMs = Math.min(5000, Math.round(backoffMs * 1.8));
                    return [3 /*break*/, 6];
                case 6: return [3 /*break*/, 1];
                case 7: return [2 /*return*/];
            }
        });
    });
}
function getApiKey() {
    var _a;
    var key = (_a = process.env.GOOGLE_GENERATIVE_AI_API_KEY) !== null && _a !== void 0 ? _a : "";
    if (!key) {
        throw new Error("Missing Convex env var GOOGLE_GENERATIVE_AI_API_KEY.");
    }
    return key;
}
exports.embed = (0, server_1.action)({
    args: {
        input: values_1.v.union(values_1.v.object({
            kind: values_1.v.literal("text"),
            text: values_1.v.string(),
        }), values_1.v.object({
            kind: values_1.v.literal("inlineData"),
            mimeType: values_1.v.string(),
            base64Data: values_1.v.string(),
        })),
    },
    handler: function (_ctx, args) { return __awaiter(void 0, void 0, void 0, function () {
        var apiKey, ai, input, res_1, values_2, res, values;
        var _a, _b, _c, _d, _e, _f;
        return __generator(this, function (_g) {
            switch (_g.label) {
                case 0:
                    apiKey = getApiKey();
                    ai = new genai_1.GoogleGenAI({ apiKey: apiKey });
                    input = args.input;
                    if (!(input.kind === "text")) return [3 /*break*/, 2];
                    return [4 /*yield*/, withRetry(function () {
                            return ai.models.embedContent({
                                model: MODEL,
                                contents: input.text,
                                config: { outputDimensionality: OUTPUT_DIM },
                            });
                        })];
                case 1:
                    res_1 = _g.sent();
                    values_2 = (_c = (_b = (_a = res_1.embeddings) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.values) !== null && _c !== void 0 ? _c : null;
                    if (!values_2 || values_2.length !== OUTPUT_DIM) {
                        throw new Error("Unexpected embedding response; expected ".concat(OUTPUT_DIM, " floats."));
                    }
                    return [2 /*return*/, l2Normalize(values_2)];
                case 2: return [4 /*yield*/, withRetry(function () {
                        return ai.models.embedContent({
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
                        });
                    })];
                case 3:
                    res = _g.sent();
                    values = (_f = (_e = (_d = res.embeddings) === null || _d === void 0 ? void 0 : _d[0]) === null || _e === void 0 ? void 0 : _e.values) !== null && _f !== void 0 ? _f : null;
                    if (!values || values.length !== OUTPUT_DIM) {
                        throw new Error("Unexpected embedding response; expected ".concat(OUTPUT_DIM, " floats."));
                    }
                    return [2 /*return*/, l2Normalize(values)];
            }
        });
    }); },
});
