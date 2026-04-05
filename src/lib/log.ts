export function formatError(e: unknown): string {
  if (e instanceof Error) {
    return `${e.name}: ${e.message}\n${e.stack ?? ""}`;
  }
  return String(e);
}

export type CreateLoggerOptions = {
  /** When true (with dev), debug/info/warn emit. In production, only this opt-in enables those levels. */
  isDebugEnabled?: () => boolean;
};

export type ScopedLogger = {
  debug: (message: string, data?: Record<string, unknown>) => void;
  info: (message: string, data?: Record<string, unknown>) => void;
  warn: (message: string, data?: Record<string, unknown>) => void;
  error: (message: string, data?: Record<string, unknown>) => void;
};

function shouldLogVerbose(isDebugEnabled?: () => boolean): boolean {
  if (import.meta.env.DEV) return true;
  return isDebugEnabled?.() === true;
}

export function createLogger(scope: string, options?: CreateLoggerOptions): ScopedLogger {
  const prefix = `[manifold][${scope}]`;

  const emitVerbose = (
    level: "debug" | "info" | "warn",
    message: string,
    data?: Record<string, unknown>,
  ) => {
    if (!shouldLogVerbose(options?.isDebugEnabled)) return;
    const line = `${prefix} ${message}`;
    const rest = data === undefined ? "" : data;
    if (level === "debug") console.debug(line, rest);
    else if (level === "info") console.info(line, rest);
    else console.warn(line, rest);
  };

  return {
    debug(message, data) {
      emitVerbose("debug", message, data);
    },
    info(message, data) {
      emitVerbose("info", message, data);
    },
    warn(message, data) {
      emitVerbose("warn", message, data);
    },
    error(message, data) {
      console.error(`${prefix} ${message}`, data === undefined ? "" : data);
    },
  };
}

export function isSearchDebugEnabled(): boolean {
  return (
    import.meta.env.DEV ||
    (typeof window !== "undefined" && window.localStorage.getItem("manifold:debug:search") === "1")
  );
}

export const searchLog = createLogger("search", { isDebugEnabled: isSearchDebugEnabled });

export const autoTagLog = createLogger("autoTag");

export function logSearchRun(
  runId: number,
  message: string,
  data?: Record<string, unknown>,
  level: "debug" | "warn" | "error" = "debug",
): void {
  const full = `[run:${runId}] ${message}`;
  if (level === "error") {
    searchLog.error(full, data);
    return;
  }
  if (level === "warn") {
    searchLog.warn(full, data);
    return;
  }
  searchLog.debug(full, data);
}

/** Global fatal handler: always logs to console (production included). */
export function reportFatalError(title: string, detail: string): void {
  console.error(`[manifold][fatal] ${title}`, detail);
}
