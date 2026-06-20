import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** pdf.js `*Url` options require a trailing slash (see `getFactoryUrlProp` in pdf.mjs). */
function fileDirUrl(absoluteDir: string): string {
  const normalized = absoluteDir.endsWith(path.sep)
    ? absoluteDir
    : `${absoluteDir}${path.sep}`;
  return pathToFileURL(normalized).href;
}

let cached: {
  wasmUrl: string;
  standardFontDataUrl: string;
  cMapUrl: string;
  iccUrl: string;
  verbosity: number;
} | null = null;

/** pdf.js VerbosityLevel.ERRORS — hides benign font warnings like "TT: undefined function: 32". */
export const PDFJS_VERBOSITY_ERRORS = 0;

/**
 * Resource base URLs for Node / Electron main when using `pdfjs-dist/legacy`.
 * Without these, wasmUrl is null, JBIG2/OpenJPEG fail, and the worker may try to
 * import the nonexistent package `nulljbig2_nowasm_fallback.js` (string concat bug).
 */
export function getPdfjsNodeDocumentInit(): {
  wasmUrl: string;
  standardFontDataUrl: string;
  cMapUrl: string;
  iccUrl: string;
  verbosity: number;
} {
  if (cached) return cached;
  const require = createRequire(import.meta.url);
  const root = path.dirname(require.resolve("pdfjs-dist/package.json"));
  cached = {
    wasmUrl: fileDirUrl(path.join(root, "wasm")),
    standardFontDataUrl: fileDirUrl(path.join(root, "standard_fonts")),
    cMapUrl: fileDirUrl(path.join(root, "cmaps")),
    iccUrl: fileDirUrl(path.join(root, "iccs")),
    verbosity: PDFJS_VERBOSITY_ERRORS,
  };
  return cached;
}
