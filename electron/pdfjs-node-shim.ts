import { createRequire } from "node:module";

let installed = false;

/**
 * pdfjs-dist's legacy build polyfills globals on load via `createRequire(import.meta.url)`.
 * That resolves from the pdf chunk path; we also force-assign here from the shim's
 * `import.meta.url` (bundled into `main.js`) so `@napi-rs/canvas` resolves reliably, and
 * we overwrite any incomplete Node globals before the first dynamic `import("pdfjs-dist")`.
 */
export function installPdfjsNodeShim(): void {
  if (installed) return;
  const require = createRequire(import.meta.url);
  let napi: typeof import("@napi-rs/canvas");
  try {
    napi = require("@napi-rs/canvas") as typeof import("@napi-rs/canvas");
  } catch {
    return;
  }
  const g = globalThis as Record<string, unknown>;
  g.Path2D = napi.Path2D;
  g.ImageData = napi.ImageData;
  g.DOMMatrix = napi.DOMMatrix;
  const prev = g.navigator as Record<string, unknown> | undefined;
  if (!prev || typeof prev.language !== "string") {
    g.navigator = {
      ...(typeof prev === "object" && prev !== null ? prev : {}),
      language: "en-US",
      platform: process.platform,
      userAgent: "Manifold",
    };
  }
  installed = true;
}

installPdfjsNodeShim();
