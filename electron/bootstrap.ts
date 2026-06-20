import { app } from "electron";

/** Must run before any other main-process module so macOS menu/Dock use Manifold, not Electron. */
app.setName("Manifold");

if (process.platform === "win32") {
  app.setAppUserModelId("com.sagarchethankumar.manifold");
}

await import("./main.js");
