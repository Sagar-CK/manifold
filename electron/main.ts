import "./pdfjs-node-shim.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  app,
  BrowserWindow,
  Menu,
  type MenuItemConstructorOptions,
} from "electron";
import { loadDotenv, repoRoot } from "./app-paths.js";
import { registerIpcHandlers } from "./ipc/index.js";
import { devLog } from "./log.js";
import * as qdrant from "./qdrant.js";
import {
  bindFirstRevealTrigger,
  type RevealSubscription,
} from "./window-reveal.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

loadDotenv();

function broadcast(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send(channel, payload);
  }
}

function buildMenu(): void {
  const shortcut =
    (action: string): (() => void) =>
    () =>
      broadcast("app://shortcut", { action });

  const navigate: MenuItemConstructorOptions = {
    label: "Navigate",
    submenu: [
      {
        label: "Search",
        accelerator: "CommandOrControl+K",
        click: shortcut("search"),
      },
      {
        label: "Graph Explorer",
        accelerator: "CommandOrControl+G",
        click: shortcut("graph"),
      },
      {
        label: "Review Suggested Tags",
        accelerator: "CommandOrControl+Shift+T",
        click: shortcut("review-tags"),
      },
      { type: "separator" },
      {
        label: "Settings",
        accelerator: "CommandOrControl+,",
        click: shortcut("settings"),
      },
    ],
  };

  const template: MenuItemConstructorOptions[] = [];

  if (process.platform === "darwin") {
    template.push({
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    });
  }

  template.push(navigate);
  template.push({ role: "editMenu" });
  template.push({
    role: "help",
    submenu: [
      {
        label: "Keyboard Shortcuts",
        accelerator: "CommandOrControl+/",
        click: shortcut("show-shortcuts"),
      },
    ],
  });

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function resolveDevServerUrl(): string | undefined {
  return process.env.VITE_DEV_SERVER_URL?.trim();
}

/** Packaged app includes `public/manifold-icon-128.png` (see package.json `build.files`). */
function resolveWindowIconPath(): string | undefined {
  const p = path.join(repoRoot(), "public", "manifold-icon-128.png");
  try {
    if (fs.existsSync(p)) return p;
  } catch {
    // ignore
  }
  return undefined;
}

/** Match zinc-950 / dark chrome flash while the renderer loads (show: false). */
const WINDOW_BACKGROUND = "#09090b";

function revealMainWindow(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  if (!win.isMaximized()) win.maximize();
  if (!win.isVisible()) win.show();
  if (process.platform === "darwin") {
    app.focus({ steal: true });
  }
  win.focus();
}

function createMainWindow(): BrowserWindow {
  const icon = resolveWindowIconPath();
  const preloadPath = path.join(__dirname, "preload.mjs");
  if (!fs.existsSync(preloadPath)) {
    devLog.error("Preload script missing — renderer desktop API will be unavailable", {
      preloadPath,
    });
  } else {
    devLog.info("Preload script resolved", { preloadPath });
  }
  const win = new BrowserWindow({
    title: "Manifold",
    width: 1280,
    height: 800,
    minWidth: 720,
    minHeight: 480,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: WINDOW_BACKGROUND,
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.webContents.on("page-title-updated", (event) => {
    event.preventDefault();
    win.setTitle("Manifold");
  });

  const revealSubscribers: RevealSubscription[] = [
    (fire) => win.once("ready-to-show", fire),
  ];
  if (process.platform === "linux") {
    revealSubscribers.push((fire) =>
      win.webContents.once("did-finish-load", fire),
    );
  }
  bindFirstRevealTrigger(revealSubscribers, () => revealMainWindow(win));

  win.webContents.on("console-message", (details) => {
    devLog.forwardRendererConsole(details);
  });

  const devUrl = resolveDevServerUrl();
  if (devUrl) {
    void win.loadURL(devUrl);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    void win.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  return win;
}

app.whenReady().then(() => {
  buildMenu();
  if (process.platform === "darwin" && !app.isPackaged) {
    const dockIcon = resolveWindowIconPath();
    if (dockIcon) app.dock?.setIcon(dockIcon);
  }
  registerIpcHandlers({
    getMainWindow: () => BrowserWindow.getFocusedWindow(),
    broadcast,
  });
  void createMainWindow();
  devLog.info("Manifold main process ready");
  void qdrant.ensureStarted().catch((error) => {
    devLog.warn("Qdrant not ready on startup", {
      error: error instanceof Error ? error.message : String(error),
    });
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createMainWindow();
  }
});

app.on("before-quit", () => {
  void qdrant.shutdown();
});
