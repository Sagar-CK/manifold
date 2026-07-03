/**
 * Starts Vite (vite-plugin-electron). On macOS, sets ELECTRON_OVERRIDE_DIST_PATH so
 * Electron runs from a cached Manifold.app (see dev-electron-mac.mjs).
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  prepareMacDevElectronRuntime,
  restoreElectronPathTxt,
} from "./dev-electron-mac.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const viteCli = path.join(repoRoot, "node_modules", "vite", "bin", "vite.js");

const env = { ...process.env };
const { electronOverrideDistPath } = prepareMacDevElectronRuntime();
if (electronOverrideDistPath) {
  env.ELECTRON_OVERRIDE_DIST_PATH = electronOverrideDistPath;
}

function cleanupDevElectronRuntime() {
  restoreElectronPathTxt();
}

const extraArgs = process.argv.slice(2);
const child = spawn(process.execPath, [viteCli, ...extraArgs], {
  cwd: repoRoot,
  stdio: "inherit",
  env,
});

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, cleanupDevElectronRuntime);
}

child.on("exit", (code, signal) => {
  cleanupDevElectronRuntime();
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code === null ? 1 : code);
});
