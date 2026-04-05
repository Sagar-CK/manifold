import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

const THUMBNAIL_CONCURRENCY = 4;

/** Cache keyed by `${maxEdge}\0${path}` so different resolutions do not collide. */
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
  return ext === "png" || ext === "jpg" || ext === "jpeg" || ext === "pdf";
}

export type UseThumbnailsForPathsOptions = {
  onThumbError?: (path: string, error: unknown) => void;
  /** Passed to `thumbnail_image_base64_png`; default 96. */
  maxEdge?: number;
  /** When true, merge multiple completions into one state update per animation frame. */
  batchUpdates?: boolean;
};

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

  const pathsRef = useRef(paths);
  pathsRef.current = paths;
  const [thumbByPath, setThumbByPath] = useState<Record<string, string>>({});
  const [thumbFailedByPath, setThumbFailedByPath] = useState<Record<string, true>>({});

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

    const previewPaths = paths.filter((p) => {
      if (!isPreviewablePath(p)) return false;
      if (readCachedUrl(p, maxEdge)) return false;
      if (sharedFailed[p]) return false;
      return true;
    });

    let cancelled = false;
    let nextIndex = 0;
    const workerCount = Math.min(THUMBNAIL_CONCURRENCY, previewPaths.length);

    const flushBatched = () => {
      flushRafRef.current = null;
      if (cancelled) return;
      const thumbs = pendingThumbsRef.current;
      const fails = pendingFailedRef.current;
      if (Object.keys(thumbs).length === 0 && Object.keys(fails).length === 0) return;
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

    const workers = Array.from({ length: workerCount }, async () => {
      while (nextIndex < previewPaths.length) {
        if (cancelled) return;
        const current = nextIndex;
        nextIndex += 1;
        const p = previewPaths[current];
        try {
          const thumb = (await invoke("thumbnail_image_base64_png", {
            args: { path: p, max_edge: maxEdge, page: 0 },
          })) as { png_base64: string };
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
    return () => {
      cancelled = true;
      if (flushRafRef.current != null) {
        cancelAnimationFrame(flushRafRef.current);
        flushRafRef.current = null;
      }
      pendingThumbsRef.current = {};
      pendingFailedRef.current = {};
    };
  }, [pathsKey, maxEdge, batchUpdates]);

  return { thumbByPath, thumbFailedByPath };
}
