import { createIpcContext, type IpcDeps } from "./context.js";
import { registerAppHandlers } from "./app-handlers.js";
import { registerEmbeddingHandlers } from "./embedding-handlers.js";
import { registerFileHandlers } from "./file-handlers.js";
import { registerGeminiHandlers } from "./gemini-handlers.js";
import { registerQdrantHandlers } from "./qdrant-handlers.js";
import { registerScanHandlers } from "./scan-handlers.js";

export type { IpcDeps } from "./context.js";

export function registerIpcHandlers(deps: IpcDeps): void {
  const ctx = createIpcContext(deps);
  registerScanHandlers();
  registerFileHandlers();
  registerQdrantHandlers(ctx);
  registerEmbeddingHandlers(ctx);
  registerGeminiHandlers(ctx);
  registerAppHandlers(deps);
}
