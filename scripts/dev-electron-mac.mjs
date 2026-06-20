/**
 * macOS dev: cache a renamed Manifold.app and point the electron npm package at it.
 *
 * macOS Dock/Finder use the .app bundle folder name, not app.setName() or window.title.
 * Patching Info.plist alone on Electron.app is not enough — the bundle must be Manifold.app.
 *
 * The `electron` package resolves its binary via path.txt relative to
 * ELECTRON_OVERRIDE_DIST_PATH (see node_modules/electron/index.js). During dev we rewrite
 * path.txt to `Manifold.app/Contents/MacOS/Electron` and restore it when pnpm dev exits.
 */
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const DISPLAY_NAME = "Manifold";
const BUNDLE_NAME = "Manifold";
const APP_BUNDLE = "Manifold.app";
const EXECUTABLE_REL = `${APP_BUNDLE}/Contents/MacOS/Electron`;

const CACHE_ROOT = path.join(
  repoRoot,
  "node_modules",
  ".cache",
  "manifold-electron-mac",
);
const OVERRIDE_DIST = path.join(CACHE_ROOT, "dist");
const FINGERPRINT_FILE = path.join(CACHE_ROOT, "fingerprint.json");
const PATH_TXT_BACKUP = path.join(CACHE_ROOT, "path.txt.original");
const CACHED_APP = path.join(OVERRIDE_DIST, APP_BUNDLE);
const INFO_PLIST = path.join(CACHED_APP, "Contents", "Info.plist");

function electronPackageRoot() {
  const require = createRequire(import.meta.url);
  const pkgJson = require.resolve("electron/package.json");
  return path.dirname(pkgJson);
}

function electronPathTxtFile() {
  return path.join(electronPackageRoot(), "path.txt");
}

function sourceElectronApp() {
  const root = electronPackageRoot();
  return path.join(root, "dist", "Electron.app");
}

function readFingerprint() {
  try {
    return JSON.parse(readFileSync(FINGERPRINT_FILE, "utf8"));
  } catch {
    return null;
  }
}

function currentFingerprint(sourceApp) {
  const root = electronPackageRoot();
  const version = JSON.parse(
    readFileSync(path.join(root, "package.json"), "utf8"),
  ).version;
  const st = statSync(sourceApp);
  return {
    version,
    mtimeMs: st.mtimeMs,
    displayName: DISPLAY_NAME,
    bundleName: BUNDLE_NAME,
    appBundle: APP_BUNDLE,
  };
}

function fingerprintsMatch(a, b) {
  if (!a || !b) return false;
  return (
    a.version === b.version &&
    a.mtimeMs === b.mtimeMs &&
    a.displayName === b.displayName &&
    a.bundleName === b.bundleName &&
    a.appBundle === b.appBundle
  );
}

function patchInfoPlist() {
  const plutil = (args) => {
    const r = spawnSync("plutil", args, { encoding: "utf8" });
    if (r.status !== 0) {
      throw new Error(
        `plutil failed (${r.status}): ${args.join(" ")}\n${r.stderr || r.stdout}`,
      );
    }
  };
  plutil([
    "-replace",
    "CFBundleDisplayName",
    "-string",
    DISPLAY_NAME,
    INFO_PLIST,
  ]);
  plutil(["-replace", "CFBundleName", "-string", BUNDLE_NAME, INFO_PLIST]);
}

function patchElectronPathTxt() {
  const pathTxt = electronPathTxtFile();
  if (!existsSync(PATH_TXT_BACKUP) && existsSync(pathTxt)) {
    writeFileSync(PATH_TXT_BACKUP, readFileSync(pathTxt, "utf8"), "utf8");
  }
  writeFileSync(pathTxt, EXECUTABLE_REL, "utf8");
}

/** Restore node_modules/electron/path.txt after dev (pnpm install expects the default). */
export function restoreElectronPathTxt() {
  if (!existsSync(PATH_TXT_BACKUP)) return;
  writeFileSync(
    electronPathTxtFile(),
    readFileSync(PATH_TXT_BACKUP, "utf8"),
    "utf8",
  );
}

/**
 * @returns {{
 *   electronOverrideDistPath: string | undefined,
 *   electronExecutablePath: string | undefined,
 *   skipped: boolean,
 *   reason?: string,
 * }}
 */
export function prepareMacDevElectronRuntime() {
  if (process.platform !== "darwin") {
    return {
      electronOverrideDistPath: undefined,
      electronExecutablePath: undefined,
      skipped: true,
      reason: "not darwin",
    };
  }

  const sourceApp = sourceElectronApp();
  if (!existsSync(sourceApp)) {
    throw new Error(
      `[dev-electron-mac] Missing Electron.app at ${sourceApp}. Run pnpm install.`,
    );
  }

  const fp = currentFingerprint(sourceApp);
  const prev = readFingerprint();
  const cacheOk =
    existsSync(CACHED_APP) &&
    existsSync(INFO_PLIST) &&
    fingerprintsMatch(prev, fp);

  if (!cacheOk) {
    if (existsSync(CACHE_ROOT)) {
      rmSync(CACHE_ROOT, { recursive: true, force: true });
    }
    mkdirSync(OVERRIDE_DIST, { recursive: true });
    cpSync(sourceApp, CACHED_APP, { recursive: true });
    writeFileSync(FINGERPRINT_FILE, `${JSON.stringify(fp, null, 2)}\n`, "utf8");
  }

  patchInfoPlist();
  patchElectronPathTxt();

  const electronExecutablePath = path.join(OVERRIDE_DIST, EXECUTABLE_REL);
  return {
    electronOverrideDistPath: OVERRIDE_DIST,
    electronExecutablePath,
    skipped: false,
  };
}
