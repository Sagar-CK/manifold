import {
  formatIndexedPathForDisplay,
  formatPathForDisplay,
} from "@/lib/files/pathDisplay";

export function formatError(e: unknown): string {
  if (e instanceof Error) {
    return `${e.name}: ${e.message}\n${e.stack ?? ""}`;
  }
  return String(e);
}

type ScopedLogger = {
  debug: (message: string, data?: Record<string, unknown>) => void;
  info: (message: string, data?: Record<string, unknown>) => void;
  warn: (message: string, data?: Record<string, unknown>) => void;
  error: (message: string, data?: Record<string, unknown>) => void;
};

function rolePrefix(): string {
  return import.meta.env.DEV ? "[client]" : "[manifold]";
}

function writeLog(
  scope: string,
  level: "debug" | "info" | "warn" | "error",
  message: string,
  data?: Record<string, unknown>,
): void {
  const line =
    `${rolePrefix()}[${scope}] ${message}` +
    (data === undefined
      ? ""
      : ` ${(() => {
          try {
            return JSON.stringify(data);
          } catch {
            return String(data);
          }
        })()}`);
  if (level === "debug") console.debug(line);
  else if (level === "info") console.info(line);
  else if (level === "warn") console.warn(line);
  else console.error(line);
}

export function createLogger(scope: string): ScopedLogger {
  const log =
    (level: "debug" | "info" | "warn" | "error") =>
    (message: string, data?: Record<string, unknown>) => {
      if (!import.meta.env.DEV && level !== "error") return;
      writeLog(scope, level, message, data);
    };

  return {
    debug: log("debug"),
    info: log("info"),
    warn: log("warn"),
    error: log("error"),
  };
}

export const searchLog = createLogger("search");
export const autoTagLog = createLogger("autoTag");

export function logSearchRun(
  runId: number,
  message: string,
  data?: Record<string, unknown>,
  level: "debug" | "warn" | "error" = "debug",
): void {
  const full = `[run:${runId}] ${message}`;
  if (level === "error") searchLog.error(full, data);
  else if (level === "warn") searchLog.warn(full, data);
  else searchLog.debug(full, data);
}

export type SearchResultLogEntry = {
  path: string;
  score: number;
  matchType: string;
};

export function formatSearchResultsForLog(
  results: Array<{ score: number; matchType: string; file: { path: string } }>,
  options?: { homePath?: string; includeRoots?: string[] },
): SearchResultLogEntry[] {
  return results.map((result) => ({
    path:
      options?.includeRoots && options.includeRoots.length > 0
        ? formatIndexedPathForDisplay(
            result.file.path,
            options.homePath ?? "",
            options.includeRoots,
          )
        : options?.homePath
          ? formatPathForDisplay(result.file.path, options.homePath)
          : result.file.path,
    score: Math.round(result.score * 1000) / 1000,
    matchType: result.matchType,
  }));
}

export function reportFatalError(title: string, detail: string): void {
  console.error(`${rolePrefix()}[fatal] ${title}`, detail);
}
