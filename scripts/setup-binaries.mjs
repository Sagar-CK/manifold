import { createHash } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const manifestPath = path.join(__dirname, "binaries-manifest.json");

function targetKey() {
  return `${process.platform}-${process.arch}`;
}

function run(command, args, cwd = repoRoot) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit" });
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

async function downloadFile(url, outputPath) {
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`Download failed for ${url}: HTTP ${res.status}`);
  }
  await mkdir(path.dirname(outputPath), { recursive: true });
  await pipeline(res.body, createWriteStream(outputPath));
}

async function sha256File(filePath) {
  const buf = await readFile(filePath);
  return createHash("sha256").update(buf).digest("hex");
}

async function verifyWithSha256(archivePath, expectedHash) {
  const archiveHash = await sha256File(archivePath);
  if (!expectedHash || !/^[a-f0-9]{64}$/.test(expectedHash)) {
    throw new Error(`Invalid static checksum provided: ${expectedHash}`);
  }
  if (archiveHash !== expectedHash) {
    throw new Error(
      `Checksum mismatch for ${path.basename(archivePath)} (expected ${expectedHash}, got ${archiveHash})`,
    );
  }
}

async function extractArchive(archiveType, archivePath, extractDir) {
  await mkdir(extractDir, { recursive: true });
  if (archiveType === "tar.gz") {
    await run("tar", ["-xzf", archivePath, "-C", extractDir]);
    return;
  }
  if (archiveType === "tar.xz") {
    await run("tar", ["-xJf", archivePath, "-C", extractDir]);
    return;
  }
  if (archiveType === "zip") {
    if (process.platform === "win32") {
      await run("powershell", [
        "-NoProfile",
        "-Command",
        `Expand-Archive -Path "${archivePath}" -DestinationPath "${extractDir}" -Force`,
      ]);
      return;
    }
    await run("unzip", ["-o", archivePath, "-d", extractDir]);
    return;
  }
  throw new Error(`Unsupported archive type: ${archiveType}`);
}

function normalizeOutputs(spec) {
  if (Array.isArray(spec.outputs) && spec.outputs.length > 0) {
    return spec.outputs;
  }
  if (spec.binaryPathInArchive && spec.outputBinaryName) {
    return [
      {
        binaryPathInArchive: spec.binaryPathInArchive,
        outputBinaryName: spec.outputBinaryName,
      },
    ];
  }
  throw new Error("Binary spec is missing output mappings");
}

function normalizeArtifacts(spec) {
  return Array.isArray(spec.artifacts) && spec.artifacts.length > 0
    ? spec.artifacts
    : [spec];
}

function expectedOutputNames(spec) {
  return normalizeArtifacts(spec).flatMap((artifact) =>
    normalizeOutputs(artifact).map((output) => output.outputBinaryName),
  );
}

function findPathRecursive(rootDir, needle) {
  const stack = [rootDir];
  const needleNorm = needle.replaceAll("\\", "/");
  return (async () => {
    while (stack.length > 0) {
      const cur = stack.pop();
      if (!cur) continue;
      const entries = await readdir(cur, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(cur, entry.name);
        if (entry.isDirectory()) {
          stack.push(full);
          continue;
        }
        const rel = path.relative(rootDir, full).replaceAll("\\", "/");
        if (rel === needleNorm || rel.endsWith(`/${needleNorm}`)) {
          return full;
        }
      }
    }
    return null;
  })();
}

async function installComponent(name, spec, outputDir) {
  const artifacts = normalizeArtifacts(spec);
  for (const [index, artifact] of artifacts.entries()) {
    const artifactLabel =
      artifacts.length > 1
        ? `${name} (${index + 1}/${artifacts.length})`
        : name;
    const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "manifold-bin-"));
    const archivePath = path.join(tmpRoot, `${name}-${index}.archive`);
    const extractDir = path.join(tmpRoot, "extract");
    try {
      console.log(`\n[setup:binaries] ${artifactLabel}: downloading`);
      await downloadFile(artifact.archiveUrl, archivePath);
      console.log(`[setup:binaries] ${artifactLabel}: verifying checksum`);
      await verifyWithSha256(archivePath, artifact.archiveSha256);
      console.log(`[setup:binaries] ${artifactLabel}: extracting`);
      await extractArchive(artifact.archiveType, archivePath, extractDir);
      await mkdir(outputDir, { recursive: true });
      for (const output of normalizeOutputs(artifact)) {
        const located = await findPathRecursive(
          extractDir,
          output.binaryPathInArchive,
        );
        if (!located) {
          throw new Error(
            `${artifactLabel} binary not found in archive: expected ${output.binaryPathInArchive}`,
          );
        }
        const outPath = path.join(outputDir, output.outputBinaryName);
        await cp(located, outPath);
        if (process.platform !== "win32") {
          await chmod(outPath, 0o755);
        }
        console.log(
          `[setup:binaries] ${artifactLabel}: installed -> ${outPath}`,
        );
      }
    } finally {
      await rm(tmpRoot, { recursive: true, force: true });
    }
  }
}

function parseArgs(argv) {
  const selected = new Set();
  if (argv.includes("--pdfium-only")) {
    selected.add("pdfium");
  }
  if (argv.includes("--qdrant-only")) {
    selected.add("qdrant");
  }
  if (argv.includes("--ffmpeg-only")) {
    selected.add("ffmpeg");
  }
  return {
    installPdfium: selected.size === 0 || selected.has("pdfium"),
    installQdrant: selected.size === 0 || selected.has("qdrant"),
    installFfmpeg: selected.size === 0 || selected.has("ffmpeg"),
  };
}

async function main() {
  const { installPdfium, installQdrant, installFfmpeg } = parseArgs(
    process.argv.slice(2),
  );

  const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
  const key = targetKey();
  const target = manifest.targets?.[key];
  if (!target) {
    throw new Error(`No binary manifest target for platform ${key}`);
  }

  const qdrantOut = path.join(repoRoot, "src-tauri", "resources", "qdrant");
  const pdfiumOut = path.join(repoRoot, "src-tauri", "resources", "pdfium");
  const ffmpegOut = path.join(repoRoot, "src-tauri", "resources", "ffmpeg");

  if (installQdrant) {
    await installComponent("qdrant", target.qdrant, qdrantOut);
  }
  if (installPdfium) {
    await installComponent("pdfium", target.pdfium, pdfiumOut);
  }
  if (installFfmpeg) {
    await installComponent("ffmpeg", target.ffmpeg, ffmpegOut);
  }

  if (
    installQdrant &&
    expectedOutputNames(target.qdrant).some(
      (name) => !existsSync(path.join(qdrantOut, name)),
    )
  ) {
    throw new Error("Qdrant binary install failed unexpectedly");
  }
  if (
    installPdfium &&
    expectedOutputNames(target.pdfium).some(
      (name) => !existsSync(path.join(pdfiumOut, name)),
    )
  ) {
    throw new Error("PDFium binary install failed unexpectedly");
  }
  if (
    installFfmpeg &&
    expectedOutputNames(target.ffmpeg).some(
      (name) => !existsSync(path.join(ffmpegOut, name)),
    )
  ) {
    throw new Error("FFmpeg binary install failed unexpectedly");
  }
  console.log("\n[setup:binaries] Completed successfully.");
}

main().catch((err) => {
  console.error(`\n[setup:binaries] ERROR: ${err.message}`);
  process.exit(1);
});
