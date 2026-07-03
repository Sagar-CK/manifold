import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { app, safeStorage } from "electron";

const FILENAME = "gemini_api_key";
const T3_PREFIX = "t3code:";

function keyFilePath(): string {
  return path.join(app.getPath("userData"), FILENAME);
}

function readStoredGeminiApiKeySync(): string | null {
  try {
    const raw = fs.readFileSync(keyFilePath(), "utf8").trim();
    if (!raw) return null;
    if (raw.startsWith(T3_PREFIX)) {
      if (!safeStorage.isEncryptionAvailable()) return null;
      const b64 = raw.slice(T3_PREFIX.length);
      try {
        return safeStorage.decryptString(Buffer.from(b64, "base64"));
      } catch {
        return null;
      }
    }
    return raw;
  } catch {
    return null;
  }
}

export type GeminiApiKeyStatusPayload = {
  configured: boolean;
  source: "appStorage" | "none";
};

export function geminiApiKeyStatus(): GeminiApiKeyStatusPayload {
  const stored = readStoredGeminiApiKeySync();
  const configured = Boolean(stored?.trim());
  return {
    configured,
    source: configured ? "appStorage" : "none",
  };
}

export async function getGeminiApiKey(): Promise<string | null> {
  let raw: string;
  try {
    raw = await fsPromises.readFile(keyFilePath(), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
  const t = raw.trim();
  if (!t) return null;

  if (t.startsWith(T3_PREFIX)) {
    if (!safeStorage.isEncryptionAvailable()) return null;
    const b64 = t.slice(T3_PREFIX.length);
    try {
      return safeStorage.decryptString(Buffer.from(b64, "base64"));
    } catch {
      return null;
    }
  }
  return t;
}

export async function saveGeminiApiKey(key: string): Promise<void> {
  const trimmed = key.trim();
  if (!trimmed) throw new Error("API key cannot be empty.");
  const dir = app.getPath("userData");
  await fsPromises.mkdir(dir, { recursive: true });
  const fp = keyFilePath();
  if (safeStorage.isEncryptionAvailable()) {
    const enc = safeStorage.encryptString(trimmed);
    const line = `${T3_PREFIX}${Buffer.from(enc).toString("base64")}`;
    await fsPromises.writeFile(fp, line, { mode: 0o600 });
  } else {
    await fsPromises.writeFile(fp, trimmed, { mode: 0o600 });
  }
}

export async function clearGeminiApiKey(): Promise<void> {
  const fp = keyFilePath();
  try {
    await fsPromises.unlink(fp);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
}
