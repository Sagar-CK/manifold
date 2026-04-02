import { createHash } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
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
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "manifold-bin-"));
  const archivePath = path.join(tmpRoot, `${name}.archive`);
  const extractDir = path.join(tmpRoot, "extract");
  try {
    console.log(`\n[setup:binaries] ${name}: downloading`);
    await downloadFile(spec.archiveUrl, archivePath);
    console.log(`[setup:binaries] ${name}: verifying checksum`);
    await verifyWithSha256(archivePath, spec.archiveSha256);
    console.log(`[setup:binaries] ${name}: extracting`);
    await extractArchive(spec.archiveType, archivePath, extractDir);
    const located = await findPathRecursive(extractDir, spec.binaryPathInArchive);
    if (!located) {
      throw new Error(
        `${name} binary not found in archive: expected ${spec.binaryPathInArchive}`,
      );
    }
    await mkdir(outputDir, { recursive: true });
    const outPath = path.join(outputDir, spec.outputBinaryName);
    await cp(located, outPath);
    if (process.platform !== "win32") {
      await chmod(outPath, 0o755);
    }
    console.log(`[setup:binaries] ${name}: installed -> ${outPath}`);
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
}

async function main() {
  const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
  const key = targetKey();
  const target = manifest.targets?.[key];
  if (!target) {
    throw new Error(`No binary manifest target for platform ${key}`);
  }

  const qdrantOut = path.join(repoRoot, "src-tauri", "resources", "qdrant");
  const pdfiumOut = path.join(repoRoot, "src-tauri", "resources", "pdfium");

  await installComponent("qdrant", target.qdrant, qdrantOut);
  await installComponent("pdfium", target.pdfium, pdfiumOut);

  if (!existsSync(path.join(qdrantOut, target.qdrant.outputBinaryName))) {
    throw new Error("Qdrant binary install failed unexpectedly");
  }
  if (!existsSync(path.join(pdfiumOut, target.pdfium.outputBinaryName))) {
    throw new Error("PDFium binary install failed unexpectedly");
  }
  console.log("\n[setup:binaries] Completed successfully.");
}

main().catch((err) => {
  console.error(`\n[setup:binaries] ERROR: ${err.message}`);
  process.exit(1);
});
