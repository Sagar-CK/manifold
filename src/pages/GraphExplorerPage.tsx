import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { ArrowLeft } from "lucide-react";
import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { navigateBackOrFallback } from "@/lib/navigateBack";
import type { LocalConfig } from "@/lib/localConfig";
import { runGraphLayout, type GraphLayoutAlgorithm } from "@/lib/graphLayout";
import { loadTagsState, type TagsState } from "@/lib/tags";
import { isPreviewablePath, useThumbnailsForPaths } from "@/lib/useThumbnailsForPaths";

type ContentPoint = {
  path: string;
  contentHash: string;
  embedding: number[];
  tagIds: string[];
};

type LayoutPoint = ContentPoint & {
  nx: number;
  ny: number;
};

const THUMB = 44;
const MARGIN = 28;
const DEFAULT_LIMIT = 500;
/** Debounce limit input so typing does not refetch on every keystroke. */
const LIMIT_DEBOUNCE_MS = 350;
const HARD_WARN = 2000;
/** Ring color when point has no tag ids or no matching TagDef */
const UNTAGGED_RING = "#94a3b8";

const ALGORITHM_OPTIONS = [
  { value: "pca" as const, label: "PCA" },
  { value: "umap" as const, label: "UMAP" },
  { value: "tsne" as const, label: "t-SNE" },
] as const;
type AlgorithmOption = (typeof ALGORITHM_OPTIONS)[number];

function parseLimitInput(raw: string): number {
  const n = Number.parseInt(raw.trim(), 10);
  if (Number.isNaN(n)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(5000, n));
}

function normalizeCoords(x: number[], y: number[]): { nx: number[]; ny: number[] } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < x.length; i++) {
    minX = Math.min(minX, x[i]);
    minY = Math.min(minY, y[i]);
    maxX = Math.max(maxX, x[i]);
    maxY = Math.max(maxY, y[i]);
  }
  const w = maxX - minX || 1;
  const h = maxY - minY || 1;
  const pad = 0.06;
  const nx = x.map((v) => pad + (1 - 2 * pad) * ((v - minX) / w));
  const ny = y.map((v) => pad + (1 - 2 * pad) * ((v - minY) / h));
  return { nx, ny };
}

function ringColorForTags(tagIds: string[], tagsState: TagsState): string {
  const map = new Map(tagsState.tags.map((t) => [t.id, t.color]));
  for (const id of tagIds) {
    const c = map.get(id);
    if (c) return c;
  }
  return UNTAGGED_RING;
}

export function GraphExplorerPage({ cfg }: { cfg: LocalConfig }) {
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const [limitInput, setLimitInput] = useState(String(DEFAULT_LIMIT));
  const [debouncedLimitInput, setDebouncedLimitInput] = useState(String(DEFAULT_LIMIT));
  const [algorithm, setAlgorithm] = useState<GraphLayoutAlgorithm>("pca");
  const [tagFilterIds, setTagFilterIds] = useState<string[]>([]);
  const [tagsState, setTagsState] = useState<TagsState>(() => loadTagsState());

  useEffect(() => {
    function refreshTags() {
      if (document.visibilityState === "visible") {
        setTagsState(loadTagsState());
      }
    }
    document.addEventListener("visibilitychange", refreshTags);
    return () => document.removeEventListener("visibilitychange", refreshTags);
  }, []);

  const [points, setPoints] = useState<LayoutPoint[]>([]);
  const [pointCount, setPointCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [layoutBusy, setLayoutBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noResults, setNoResults] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  /** Re-render skeleton overlay when a canvas Image finishes decoding. */
  const [, setThumbLoadEpoch] = useState(0);
  const [viewSize, setViewSize] = useState({ cw: 0, ch: 0 });
  const dragRef = useRef<{ active: boolean; sx: number; sy: number; px: number; py: number } | null>(
    null,
  );

  const pathsKey = useMemo(
    () => points.map((p) => p.path).sort().join("\0"),
    [points],
  );
  const paths = useMemo(() => points.map((p) => p.path), [points]);
  const { thumbByPath, thumbFailedByPath } = useThumbnailsForPaths(pathsKey, paths);

  const imgCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const r = wrap.getBoundingClientRect();
    const cw = r.width;
    const ch = r.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, cw, ch);

    const innerW = cw - 2 * MARGIN;
    const innerH = ch - 2 * MARGIN;
    const cx = cw / 2;
    const cy = ch / 2;

    ctx.save();
    ctx.translate(cx + pan.x, cy + pan.y);
    ctx.scale(scale, scale);
    ctx.translate(-cx, -cy);

    const radius = THUMB / 2 / scale;
    const size = THUMB / scale;
    const labelPx = 10 / scale;
    const tagRingExtra = 3 / scale;
    for (const pt of points) {
      const px = MARGIN + pt.nx * innerW;
      const py = MARGIN + pt.ny * innerH;
      const isSel = pt.path === selectedPath;
      const img = imgCacheRef.current.get(pt.path);
      const ringColor = ringColorForTags(pt.tagIds, tagsState);

      ctx.strokeStyle = ringColor;
      ctx.lineWidth = 2.5 / scale;
      ctx.beginPath();
      ctx.arc(px, py, radius + tagRingExtra, 0, Math.PI * 2);
      ctx.stroke();

      ctx.save();
      ctx.beginPath();
      ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      if (img?.complete && img.naturalWidth > 0) {
        ctx.drawImage(img, px - radius, py - radius, size, size);
      } else if (thumbFailedByPath[pt.path] || !isPreviewablePath(pt.path)) {
        ctx.fillStyle = thumbFailedByPath[pt.path] ? "#d4d4d8" : "#f4f4f5";
        ctx.fillRect(px - radius, py - radius, size, size);
        const ext = pt.path.split(".").pop()?.slice(0, 4).toUpperCase() ?? "";
        ctx.fillStyle = "#71717a";
        ctx.font = `${labelPx}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(ext || "·", px, py);
      }
      /* else: previewable, thumbnail still loading — leave clip transparent; Skeleton shows below canvas */
      ctx.restore();
      if (isSel) {
        ctx.strokeStyle = "rgba(239, 68, 68, 0.85)";
        ctx.lineWidth = 3 / scale;
        ctx.beginPath();
        ctx.arc(px, py, radius + tagRingExtra + 2 / scale, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    ctx.restore();
  }, [points, pan, scale, selectedPath, thumbByPath, thumbFailedByPath, tagsState]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    const cache = imgCacheRef.current;
    let cancelled = false;
    for (const p of paths) {
      const url = thumbByPath[p];
      if (!url || cache.has(p)) continue;
      const img = new Image();
      img.src = url;
      img.onload = () => {
        if (cancelled) return;
        cache.set(p, img);
        setThumbLoadEpoch((n) => n + 1);
        draw();
      };
    }
    return () => {
      cancelled = true;
    };
  }, [pathsKey, thumbByPath, draw, paths]);

  useEffect(() => {
    const ro = new ResizeObserver(() => {
      const canvas = canvasRef.current;
      const wrap = wrapRef.current;
      if (!canvas || !wrap) return;
      const r = wrap.getBoundingClientRect();
      setViewSize({ cw: r.width, ch: r.height });
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(r.width * dpr);
      canvas.height = Math.floor(r.height * dpr);
      canvas.style.width = `${r.width}px`;
      canvas.style.height = `${r.height}px`;
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw();
    });
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [draw]);

  const selectedAlgorithmOption: AlgorithmOption | null =
    ALGORITHM_OPTIONS.find((o) => o.value === algorithm) ?? ALGORITHM_OPTIONS[0];

  const runLoad = useCallback(
    async (limit: number, algo: GraphLayoutAlgorithm, tagFilters: string[]) => {
      setLimitInput(String(limit));
      setAlgorithm(algo);
      setError(null);
      setNoResults(false);
      setLoading(true);
      setLayoutBusy(false);
      setPoints([]);
      setPointCount(null);
      try {
        const res = (await invoke("qdrant_scroll_content_vectors", {
          args: {
            sourceId: cfg.sourceId,
            limit,
            tagFilterIds: tagFilters.length > 0 ? tagFilters : undefined,
          },
        })) as { points: ContentPoint[] };

        if (res.points.length === 0) {
          setNoResults(true);
          return;
        }

        const n = res.points.length;
        setPointCount(n);
        const d = res.points[0].embedding.length;
        const flat = new Float32Array(n * d);
        for (let i = 0; i < n; i++) {
          flat.set(res.points[i].embedding, i * d);
        }

        setLayoutBusy(true);
        const { x, y } = await runGraphLayout(flat, n, d, algo);
        const { nx, ny } = normalizeCoords(Array.from(x), Array.from(y));
        const next: LayoutPoint[] = res.points.map((p, i) => ({
          ...p,
          nx: nx[i] ?? 0,
          ny: ny[i] ?? 0,
        }));
        setPoints(next);
        setPan({ x: 0, y: 0 });
        setScale(1);
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
        setLayoutBusy(false);
      }
    },
    [cfg.sourceId],
  );

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedLimitInput(limitInput), LIMIT_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [limitInput]);

  useEffect(() => {
    void runLoad(parseLimitInput(debouncedLimitInput), algorithm, tagFilterIds);
  }, [debouncedLimitInput, algorithm, tagFilterIds, runLoad]);

  function hitTest(clientX: number, clientY: number): string | null {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const r = canvas.getBoundingClientRect();
    const sx = clientX - r.left;
    const sy = clientY - r.top;
    const cw = r.width;
    const ch = r.height;
    const innerW = cw - 2 * MARGIN;
    const innerH = ch - 2 * MARGIN;
    const cx = cw / 2;
    const cy = ch / 2;

    for (let i = points.length - 1; i >= 0; i--) {
      const pt = points[i];
      const px = MARGIN + pt.nx * innerW;
      const py = MARGIN + pt.ny * innerH;
      const tsx = (px - cx) * scale + cx + pan.x;
      const tsy = (py - cy) * scale + cy + pan.y;
      const dx = sx - tsx;
      const dy = sy - tsy;
      if (dx * dx + dy * dy <= (THUMB / 2 + 4) * (THUMB / 2 + 4)) {
        return pt.path;
      }
    }
    return null;
  }

  const limitParsed = parseLimitInput(limitInput);

  function toggleTagFilter(id: string) {
    setTagFilterIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  return (
    <section className="flex h-full min-h-0 flex-col">
      <div className="relative mb-8 shrink-0">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="absolute left-0 top-0 inline-flex h-9 w-9 items-center justify-center rounded-md text-black/70 hover:bg-black/5 hover:text-black"
              aria-label="Back"
              onClick={() => navigateBackOrFallback(navigate)}
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Back</TooltipContent>
        </Tooltip>
        <PageHeader
          heading="Graph explorer"
          subtitle="Content embeddings · manifold_files_content_v2"
        />
      </div>

      <div className="mb-3 flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
          <label className="flex flex-col gap-1 text-left">
            <span className="app-label text-xs">Limit</span>
            <Input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={limitInput}
              onChange={(e) => setLimitInput(e.target.value)}
              onBlur={() => {
                const n = parseLimitInput(limitInput);
                setLimitInput(String(n));
              }}
              className="h-9 w-24"
              aria-label="Point limit"
            />
          </label>
          <label className="flex flex-col gap-1 text-left">
            <span className="app-label text-xs">Algorithm</span>
            <Combobox<AlgorithmOption>
              value={selectedAlgorithmOption}
              onValueChange={(value) => {
                if (!value) return;
                setAlgorithm(value.value);
              }}
            >
              <ComboboxInput readOnly showClear={false} aria-label="Layout algorithm" className="w-40" />
              <ComboboxContent>
                <ComboboxList>
                  {ALGORITHM_OPTIONS.map((option) => (
                    <ComboboxItem key={option.value} value={option}>
                      {option.label}
                    </ComboboxItem>
                  ))}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
          </label>
          <div className="flex min-w-[12rem] max-w-full flex-1 flex-col gap-1.5">
            <span className="app-label text-xs">Filter by tags (OR)</span>
            {tagsState.tags.length === 0 ? (
              <p className="text-xs leading-9 text-black/45">Define tags in Settings to filter this view.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {tagsState.tags.map((t) => {
                  const on = tagFilterIds.includes(t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => toggleTagFilter(t.id)}
                      className="rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors"
                      style={
                        on
                          ? {
                              backgroundColor: `${t.color}20`,
                              borderColor: t.color,
                            }
                          : { borderColor: "rgba(0,0,0,0.12)" }
                      }
                    >
                      {t.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {tagsState.tags.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 text-[10px] text-black/55">
            <span>Legend:</span>
            {tagsState.tags.map((t) => (
              <span key={t.id} className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: t.color }} />
                {t.name}
              </span>
            ))}
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: UNTAGGED_RING }} />
              Untagged
            </span>
          </div>
        ) : null}
      </div>

      {limitParsed > HARD_WARN ? (
        <p className="app-muted mb-2 text-center text-xs">
          Large limits may freeze the browser during layout. Consider {HARD_WARN} or fewer.
        </p>
      ) : null}

      {error ? (
        <div className="mb-2 text-center text-sm font-medium text-rose-700">{error}</div>
      ) : null}

      <div
        ref={wrapRef}
        className="relative min-h-0 flex-1 overflow-hidden rounded-lg border border-black/10 bg-[#eceef2]"
      >
        {loading || layoutBusy ? (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-4">
            <Spinner className="size-8 text-muted-foreground" />
          </div>
        ) : noResults ? (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-4">
            <p className="text-center text-sm text-muted-foreground">
              No results for the current filters.
            </p>
          </div>
        ) : null}
        {viewSize.cw > 0 && viewSize.ch > 0 && !loading && !layoutBusy && !noResults ? (
          <div className="pointer-events-none absolute inset-0 z-[1]" aria-hidden="true">
            {points.map((pt) => {
              if (!isPreviewablePath(pt.path) || thumbFailedByPath[pt.path]) return null;
              const img = imgCacheRef.current.get(pt.path);
              if (img?.complete && img.naturalWidth > 0) return null;
              const innerW = viewSize.cw - 2 * MARGIN;
              const innerH = viewSize.ch - 2 * MARGIN;
              const cx = viewSize.cw / 2;
              const cy = viewSize.ch / 2;
              const px = MARGIN + pt.nx * innerW;
              const py = MARGIN + pt.ny * innerH;
              const tsx = (px - cx) * scale + cx + pan.x;
              const tsy = (py - cy) * scale + cy + pan.y;
              return (
                <Skeleton
                  key={pt.path}
                  className="absolute rounded-full"
                  style={{
                    left: tsx - THUMB / 2,
                    top: tsy - THUMB / 2,
                    width: THUMB,
                    height: THUMB,
                  }}
                />
              );
            })}
          </div>
        ) : null}
        <canvas
          ref={canvasRef}
          className="relative z-[2] h-full w-full cursor-grab active:cursor-grabbing"
          role="img"
          aria-label="Embedding graph"
          onPointerDown={(e) => {
            (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
            dragRef.current = { active: true, sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y };
          }}
          onPointerMove={(e) => {
            const d = dragRef.current;
            if (!d?.active) return;
            setPan({
              x: d.px + (e.clientX - d.sx),
              y: d.py + (e.clientY - d.sy),
            });
          }}
          onPointerUp={(e) => {
            dragRef.current = null;
            (e.target as HTMLCanvasElement).releasePointerCapture(e.pointerId);
          }}
          onPointerLeave={(e) => {
            dragRef.current = null;
            try {
              (e.target as HTMLCanvasElement).releasePointerCapture(e.pointerId);
            } catch {
              /* noop */
            }
          }}
          onWheel={(e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? 0.92 : 1.08;
            setScale((s) => Math.min(4, Math.max(0.25, s * delta)));
          }}
          onClick={(e) => {
            const path = hitTest(e.clientX, e.clientY);
            if (!path) {
              setSelectedPath(null);
              return;
            }
            setSelectedPath(path);
            if (e.detail === 2) {
              navigate(`/file?path=${encodeURIComponent(path)}`);
            }
          }}
        />
        {points.length > 0 ? (
          <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-white/90 px-2 py-1 text-[10px] text-black/60">
            Drag to pan · wheel to zoom · click select · double-click open
          </div>
        ) : null}
        {pointCount !== null && !error ? (
          <div className="pointer-events-none absolute bottom-2 right-2 rounded bg-white/90 px-2 py-1 text-[10px] text-black/60">
            {pointCount} point{pointCount === 1 ? "" : "s"}
          </div>
        ) : null}
      </div>
    </section>
  );
}
