import { mkdir, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const source = path.join(repoRoot, "public", "manifold.png");
const buildDir = path.join(repoRoot, "build");
const publicDir = path.join(repoRoot, "public");

const outputs = [
  { out: path.join(buildDir, "icon.png"), size: 512, label: "electron-builder" },
  {
    out: path.join(publicDir, "manifold-icon-128.png"),
    size: 128,
    label: "app UI + favicon",
  },
];

async function resizeWithSips(sourcePath, outPath, size) {
  const r = spawnSync(
    "sips",
    ["-z", String(size), String(size), sourcePath, "--out", outPath],
    { stdio: "inherit" },
  );
  if (r.status !== 0) {
    throw new Error(`sips failed to resize ${outPath}`);
  }
}

async function resizeWithSharp(sourcePath, outPath, size) {
  const sharp = await import("sharp").then((m) => m.default);
  await sharp(sourcePath).resize(size, size).png().toFile(outPath);
}

async function main() {
  try {
    await access(source);
  } catch {
    throw new Error(`Missing ${source} — cannot generate app icons`);
  }
  await mkdir(buildDir, { recursive: true });
  await mkdir(publicDir, { recursive: true });

  const resize =
    process.platform === "darwin" ? resizeWithSips : resizeWithSharp;

  for (const { out, size, label } of outputs) {
    await resize(source, out, size);
    console.log(`[generate-app-icon] ${out} (${size}×${size}, ${label})`);
  }
}

main().catch((err) => {
  console.error(`[generate-app-icon] ERROR: ${err.message}`);
  process.exit(1);
});
