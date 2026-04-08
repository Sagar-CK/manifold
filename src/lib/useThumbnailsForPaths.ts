import { useEffect, useRef, useState } from "react";
import { thumbnailImageBase64Png } from "@/lib/api/tauri";

const DEFAULT_THUMBNAIL_CONCURRENCY = 4;

const sharedCache: Record<string, string> = {};
const sharedFailed: Record<string, true> = {};

function cacheKey(path: string, maxEdge: number): string {
  return `${maxEdge}\0${path}`;
}

function readCachedUrl(path: string, maxEdge: number): string | undefined {
  const k = cacheKey(path, maxEdge);
  const v = sharedCache[k];
  if (v !== undefined) return v;
  if (maxEdge === 96 && sharedCache[path] !== undefined) {
    sharedCache[k] = sharedCache[path];
    return sharedCache[k];
  }
  return undefined;
}

export function isPreviewablePath(path: string) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return (
    ext === "png" ||
    ext === "jpg" ||
    ext === "jpeg" ||
    ext === "pdf" ||
    ext === "mp4" ||
    ext === "mov"
  );
}

type UseThumbnailsForPathsOptions = {
  onThumbError?: (path: string, error: unknown) => void;
  maxEdge?: number;
  batchUpdates?: boolean;
  concurrency?: number;
  reorderPreviewPaths?: (previewPaths: string[]) => string[];
  deferStartUntilIdle?: boolean;
  requestedPaths?: string[];
  priorityPaths?: string[];
};

export function prioritizePaths(
  paths: string[],
  priorityPaths?: string[],
): string[] {
  if (!priorityPaths || priorityPaths.length === 0) return paths;
  const allowed = new Set(paths);
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const path of priorityPaths) {
    if (!allowed.has(path) || seen.has(path)) continue;
    seen.add(path);
    ordered.push(path);
  }
  for (const path of paths) {
    if (seen.has(path)) continue;
    seen.add(path);
    ordered.push(path);
  }
  return ordered;
}

export function resolveThumbnailQueuePaths(
  paths: string[],
  requestedPaths?: string[],
  priorityPaths?: string[],
): string[] {
  const requestedSet =
    requestedPaths && requestedPaths.length > 0
      ? new Set(requestedPaths)
      : null;
  const previewPaths = paths.filter((path) => {
    if (!isPreviewablePath(path)) return false;
    if (requestedSet && !requestedSet.has(path)) return false;
    return true;
  });
  return prioritizePaths(previewPaths, priorityPaths);
}

/** Loads PNG thumbnails for previewable paths (module-level cache). */
export function useThumbnailsForPaths(
  pathsKey: string,
  paths: string[],
  options?: UseThumbnailsForPathsOptions,
) {
  const onThumbErrorRef = useRef(options?.onThumbError);
  onThumbErrorRef.current = options?.onThumbError;
  const maxEdge = options?.maxEdge ?? 96;
  const batchUpdates = options?.batchUpdates ?? false;
  const concurrency = options?.concurrency ?? DEFAULT_THUMBNAIL_CONCURRENCY;
  const reorderRef = useRef(options?.reorderPreviewPaths);
  reorderRef.current = options?.reorderPreviewPaths;
  const deferStartUntilIdle = options?.deferStartUntilIdle ?? false;
  const requestedPathsRef = useRef(options?.requestedPaths);
  requestedPathsRef.current = options?.requestedPaths;
  const priorityPathsRef = useRef(options?.priorityPaths);
  priorityPathsRef.current = options?.priorityPaths;
  const requestedPathsKey = options?.requestedPaths?.join("\0") ?? "";
  const priorityPathsKey = options?.priorityPaths?.join("\0") ?? "";

  const pathsRef = useRef(paths);
  pathsRef.current = paths;
  const [thumbByPath, setThumbByPath] = useState<Record<string, string>>({});
  const [thumbFailedByPath, setThumbFailedByPath] = useState<
    Record<string, true>
  >({});

  const pendingThumbsRef = useRef<Record<string, string>>({});
  const pendingFailedRef = useRef<Record<string, true>>({});
  const flushRafRef = useRef<number | null>(null);

  useEffect(() => {
    const paths = pathsRef.current;
    const cachedMap: Record<string, string> = {};
    const failedMap: Record<string, true> = {};
    for (const p of paths) {
      const c = readCachedUrl(p, maxEdge);
      if (c) cachedMap[p] = c;
      if (sharedFailed[p]) failedMap[p] = true;
    }
    setThumbByPath(cachedMap);
    setThumbFailedByPath(failedMap);

    let previewPaths = paths.filter((p) => {
      if (readCachedUrl(p, maxEdge)) return false;
      if (sharedFailed[p]) return false;
      return true;
    });

    previewPaths = resolveThumbnailQueuePaths(
      previewPaths,
      requestedPathsRef.current,
      priorityPathsRef.current,
    );

    const reorder = reorderRef.current;
    if (reorder) previewPaths = reorder(previewPaths);

    let cancelled = false;
    let nextIndex = 0;
    const workerCount = Math.min(concurrency, Math.max(1, previewPaths.length));

    const flushBatched = () => {
      flushRafRef.current = null;
      if (cancelled) return;
      const thumbs = pendingThumbsRef.current;
      const fails = pendingFailedRef.current;
      if (Object.keys(thumbs).length === 0 && Object.keys(fails).length === 0)
        return;
      pendingThumbsRef.current = {};
      pendingFailedRef.current = {};
      if (Object.keys(thumbs).length > 0) {
        setThumbByPath((m) => ({ ...m, ...thumbs }));
        setThumbFailedByPath((m) => {
          let changed = false;
          const next = { ...m };
          for (const p of Object.keys(thumbs)) {
            if (next[p]) {
              delete next[p];
              changed = true;
            }
          }
          return changed ? next : m;
        });
      }
      if (Object.keys(fails).length > 0) {
        setThumbFailedByPath((m) => ({ ...m, ...fails }));
      }
    };

    const scheduleFlush = () => {
      if (!batchUpdates) return;
      if (flushRafRef.current != null) return;
      flushRafRef.current = requestAnimationFrame(flushBatched);
    };

    const runWorkers = () => {
      const workers = Array.from({ length: workerCount }, async () => {
        while (nextIndex < previewPaths.length) {
          if (cancelled) return;
          const current = nextIndex;
          nextIndex += 1;
          const p = previewPaths[current];
          try {
            const thumb = await thumbnailImageBase64Png(p, maxEdge, 0);
            const dataUrl = `data:image/png;base64,${thumb.png_base64}`;
            sharedCache[cacheKey(p, maxEdge)] = dataUrl;
            delete sharedFailed[p];
            if (cancelled) return;
            if (batchUpdates) {
              pendingThumbsRef.current[p] = dataUrl;
              scheduleFlush();
            } else {
              setThumbByPath((m) => ({ ...m, [p]: dataUrl }));
              setThumbFailedByPath((m) => {
                if (!m[p]) return m;
                const next = { ...m };
                delete next[p];
                return next;
              });
            }
          } catch (e) {
            sharedFailed[p] = true;
            if (cancelled) return;
            onThumbErrorRef.current?.(p, e);
            if (batchUpdates) {
              pendingFailedRef.current[p] = true;
              scheduleFlush();
            } else {
              setThumbFailedByPath((m) => ({ ...m, [p]: true }));
            }
          }
        }
      });

      void Promise.all(workers);
    };

    let idleId: number | null = null;
    if (
      deferStartUntilIdle &&
      previewPaths.length > 0 &&
      typeof requestIdleCallback !== "undefined"
    ) {
      idleId = requestIdleCallback(
        () => {
          idleId = null;
          if (!cancelled) runWorkers();
        },
        { timeout: 800 },
      );
    } else {
      runWorkers();
    }

    return () => {
      cancelled = true;
      if (idleId !== null && typeof cancelIdleCallback !== "undefined") {
        cancelIdleCallback(idleId);
      }
      if (flushRafRef.current != null) {
        cancelAnimationFrame(flushRafRef.current);
        flushRafRef.current = null;
      }
      pendingThumbsRef.current = {};
      pendingFailedRef.current = {};
    };
  }, [
    pathsKey,
    maxEdge,
    batchUpdates,
    concurrency,
    deferStartUntilIdle,
    requestedPathsKey,
    priorityPathsKey,
  ]);

  return { thumbByPath, thumbFailedByPath };
}
