import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

type PdfjsLegacyModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

let workerSrcHref: string | null = null;

function resolvePdfjsWorkerHref(): string {
  if (workerSrcHref) return workerSrcHref;
  const require = createRequire(import.meta.url);
  const resolved = require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");
  workerSrcHref = pathToFileURL(resolved).href;
  return workerSrcHref;
}

/** Legacy pdf.mjs for Node; points the fake worker at the real worker file (Vite chunks break `./pdf.worker.mjs`). */
export async function importPdfjsLegacy(): Promise<PdfjsLegacyModule> {
  const pdfjs = (await import(
    "pdfjs-dist/legacy/build/pdf.mjs"
  )) as PdfjsLegacyModule;
  pdfjs.GlobalWorkerOptions.workerSrc = resolvePdfjsWorkerHref();
  return pdfjs;
}
