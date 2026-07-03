import { app } from "electron";

function isDev(): boolean {
  try {
    return !app.isPackaged;
  } catch {
    return process.env.NODE_ENV !== "production";
  }
}

function write(
  level: "debug" | "info" | "warn" | "error",
  message: string,
  data?: Record<string, unknown>,
): void {
  const fn =
    level === "debug"
      ? console.debug
      : level === "info"
        ? console.info
        : level === "warn"
          ? console.warn
          : console.error;
  if (data === undefined) {
    fn(`[server] ${message}`);
    return;
  }
  fn(`[server] ${message}`, data);
}

export const devLog = {
  debug(message: string, data?: Record<string, unknown>) {
    if (!isDev()) return;
    write("debug", message, data);
  },
  info(message: string, data?: Record<string, unknown>) {
    if (!isDev()) return;
    write("info", message, data);
  },
  warn(message: string, data?: Record<string, unknown>) {
    if (!isDev()) return;
    write("warn", message, data);
  },
  error(message: string, data?: Record<string, unknown>) {
    write("error", message, data);
  },

  forwardRendererConsole(
    details: Electron.WebContentsConsoleMessageEventParams,
  ) {
    if (!isDev()) return;
    const message = details.message.trim();
    if (!message.startsWith("[client]") || message.includes("[vite]")) return;
    const fn = details.level === "error" ? console.error : console.log;
    fn(message);
  },
};
