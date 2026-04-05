import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

const THUMBNAIL_CONCURRENCY = 4;

export function isPreviewablePath(path: string) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return ext === "png" || ext === "jpg" || ext === "jpeg" || ext === "pdf";
}

/**
 * Loads PNG thumbnails for previewable paths (in-memory cache for this hook instance).
 */
export function useThumbnailsForPaths(pathsKey: string, paths: string[]) {
  const cacheRef = useRef<Record<string, string>>({});
  const failedRef = useRef<Record<string, true>>({});
  const pathsRef = useRef(paths);
  pathsRef.current = paths;
  const [thumbByPath, setThumbByPath] = useState<Record<string, string>>({});
  const [thumbFailedByPath, setThumbFailedByPath] = useState<Record<string, true>>({});

  useEffect(() => {
    const paths = pathsRef.current;
    const cachedMap: Record<string, string> = {};
    const failedMap: Record<string, true> = {};
    for (const p of paths) {
      const c = cacheRef.current[p];
      if (c) cachedMap[p] = c;
      if (failedRef.current[p]) failedMap[p] = true;
    }
    setThumbByPath(cachedMap);
    setThumbFailedByPath(failedMap);

    const previewPaths = paths.filter((p) => {
      if (!isPreviewablePath(p)) return false;
      if (cacheRef.current[p]) return false;
      if (failedRef.current[p]) return false;
      return true;
    });

    let cancelled = false;
    let nextIndex = 0;
    const workerCount = Math.min(THUMBNAIL_CONCURRENCY, previewPaths.length);

    const workers = Array.from({ length: workerCount }, async () => {
      while (nextIndex < previewPaths.length) {
        if (cancelled) return;
        const current = nextIndex;
        nextIndex += 1;
        const p = previewPaths[current];
        try {
          const thumb = (await invoke("thumbnail_image_base64_png", {
            args: { path: p, max_edge: 96, page: 0 },
          })) as { png_base64: string };
          const dataUrl = `data:image/png;base64,${thumb.png_base64}`;
          cacheRef.current[p] = dataUrl;
          delete failedRef.current[p];
          if (!cancelled) {
            setThumbByPath((m) => ({ ...m, [p]: dataUrl }));
            setThumbFailedByPath((m) => {
              if (!m[p]) return m;
              const next = { ...m };
              delete next[p];
              return next;
            });
          }
        } catch {
          failedRef.current[p] = true;
          if (!cancelled) {
            setThumbFailedByPath((m) => ({ ...m, [p]: true }));
          }
        }
      }
    });

    void Promise.all(workers);
    return () => {
      cancelled = true;
    };
  }, [pathsKey]);

  return { thumbByPath, thumbFailedByPath };
}
