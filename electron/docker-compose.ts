import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { app } from "electron";
import { repoRoot } from "./app-paths.js";

const DOCKER_DESKTOP_URL = "https://www.docker.com/products/docker-desktop/";

function expandHome(input: string): string {
  if (input.startsWith("~/")) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
}

export function resolveDockerBinary(): string | null {
  const name = process.platform === "win32" ? "docker.exe" : "docker";
  const seen = new Set<string>();
  const candidates: string[] = [];

  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    candidates.push(path.join(expandHome(dir), name));
  }

  if (process.platform === "darwin") {
    candidates.push(
      "/usr/local/bin/docker",
      "/opt/homebrew/bin/docker",
      "/Applications/Docker.app/Contents/Resources/bin/docker",
    );
  } else if (process.platform === "win32") {
    candidates.push(
      "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe",
    );
  } else {
    candidates.push("/usr/bin/docker", "/usr/local/bin/docker");
  }

  for (const candidate of candidates) {
    const normalized = path.normalize(candidate);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    try {
      if (fs.existsSync(normalized)) return normalized;
    } catch {
      // ignore
    }
  }

  return null;
}

function dockerComposeCandidates(): string[] {
  const roots = new Set<string>();
  roots.add(repoRoot());
  roots.add(process.cwd());

  try {
    roots.add(app.getAppPath());
    roots.add(path.dirname(app.getPath("exe")));
  } catch {
    // app paths unavailable during early import
  }

  return [...roots].map((root) => path.join(root, "docker-compose.yml"));
}

export function findDockerComposeFile(): string | null {
  for (const candidate of dockerComposeCandidates()) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // ignore
    }
  }
  return null;
}

function runCommand(
  command: string,
  args: string[],
  cwd = repoRoot(),
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        PATH: process.env.PATH ?? defaultPath(),
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

function defaultPath(): string {
  if (process.platform === "darwin") {
    return "/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/homebrew/bin";
  }
  if (process.platform === "win32") {
    return "C:\\Windows\\system32;C:\\Windows";
  }
  return "/usr/bin:/bin:/usr/local/bin";
}

function runDocker(args: string[], cwd = repoRoot()) {
  const docker = resolveDockerBinary();
  if (!docker) {
    throw new Error(
      `Docker was not found. Install Docker Desktop, then try again. ${DOCKER_DESKTOP_URL}`,
    );
  }
  return runCommand(docker, args, cwd);
}

async function ensureDockerDaemonReady(): Promise<void> {
  let probe = await runDocker(["info"]).catch(() => null);
  if (probe?.code === 0) return;

  if (process.platform === "darwin") {
    try {
      await runCommand("/usr/bin/open", ["-a", "Docker"]);
    } catch {
      // Docker Desktop may already be starting
    }

    for (let attempt = 0; attempt < 30; attempt += 1) {
      await sleep(2000);
      probe = await runDocker(["info"]).catch(() => null);
      if (probe?.code === 0) return;
    }
  }

  const detail = probe?.stderr.trim() || probe?.stdout.trim();
  throw new Error(
    detail
      ? `Docker is installed but not running. Start Docker Desktop, then try again. (${detail})`
      : "Docker is installed but not running. Start Docker Desktop, then try again.",
  );
}

export async function qdrantDockerQuickStartAvailable(): Promise<{
  available: boolean;
  reason?: string;
  dockerInstalled: boolean;
  composeFile: string | null;
}> {
  const composeFile = findDockerComposeFile();
  const dockerInstalled = resolveDockerBinary() !== null;

  if (!composeFile) {
    return {
      available: false,
      dockerInstalled,
      composeFile: null,
      reason:
        "Could not find docker-compose.yml. Run Manifold from the project folder, or start Qdrant with `pnpm qdrant:up` in a terminal.",
    };
  }

  if (!dockerInstalled) {
    return {
      available: false,
      dockerInstalled: false,
      composeFile,
      reason: `Docker Desktop is required for one-click setup. Install it from ${DOCKER_DESKTOP_URL}`,
    };
  }

  try {
    await ensureDockerDaemonReady();
  } catch (error) {
    return {
      available: false,
      dockerInstalled: true,
      composeFile,
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  return {
    available: true,
    dockerInstalled: true,
    composeFile,
  };
}

export async function startQdrantDockerContainer(): Promise<{ message: string }> {
  const availability = await qdrantDockerQuickStartAvailable();
  if (!availability.available || !availability.composeFile) {
    const reason =
      availability.reason ??
      "Could not start Qdrant with Docker. Install Docker Desktop or run `pnpm qdrant:up` in a terminal.";
    throw new Error(reason);
  }

  const result = await runDocker(
    ["compose", "-f", availability.composeFile, "up", "-d", "qdrant"],
    path.dirname(availability.composeFile),
  );

  if (result.code !== 0) {
    const detail = (result.stderr || result.stdout).trim();
    throw new Error(
      detail ||
        `docker compose up failed with exit code ${result.code}. Ensure Docker Desktop is running.`,
    );
  }

  return {
    message:
      "Qdrant is starting in Docker. This can take a few seconds on first launch.",
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
