import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: repoRoot, stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

async function ensureResourceDirs() {
  await mkdir(path.join(repoRoot, "resources", "pdfium"), {
    recursive: true,
  });
  await mkdir(path.join(repoRoot, "resources", "ffmpeg"), {
    recursive: true,
  });
}

async function main() {
  await ensureResourceDirs();
  await run(process.execPath, ["./scripts/generate-app-icon.mjs"]);
  await run(process.execPath, [
    "./scripts/setup-binaries.mjs",
    "--pdfium-only",
    "--ffmpeg-only",
  ]);
  console.log("\n[setup:dev] Complete.");
  console.log("[setup:dev] Start Qdrant: pnpm qdrant:up");
  console.log("[setup:dev] Then run: pnpm dev");
}

main().catch((err) => {
  console.error(`[setup:dev] ERROR: ${err.message}`);
  process.exit(1);
});
