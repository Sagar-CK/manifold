import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/PageHeader";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { navigateBackOrFallback } from "@/lib/navigateBack";
import type { LocalConfig } from "@/lib/localConfig";
import { runGraphLayout, type GraphLayoutAlgorithm } from "@/lib/graphLayout";
import { useThumbnailsForPaths } from "@/lib/useThumbnailsForPaths";

type ContentPoint = {
  path: string;
  contentHash: string;
  embedding: number[];
};

type LayoutPoint = ContentPoint & {
  nx: number;
  ny: number;
};

const THUMB = 44;
const MARGIN = 28;
const DEFAULT_LIMIT = 500;
const HARD_WARN = 2000;

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

export function GraphExplorerPage({ cfg }: { cfg: LocalConfig }) {
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const [limitInput, setLimitInput] = useState(String(DEFAULT_LIMIT));
  const [algorithm, setAlgorithm] = useState<GraphLayoutAlgorithm>("pca");
  const [points, setPoints] = useState<LayoutPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [layoutBusy, setLayoutBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
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

    ctx.fillStyle = "#eceef2";
    ctx.fillRect(0, 0, cw, ch);

    const innerW = cw - 2 * MARGIN;
    const innerH = ch - 2 * MARGIN;
    const cx = cw / 2;
    const cy = ch / 2;

    ctx.save();
    ctx.translate(cx + pan.x, cy + pan.y);
    ctx.scale(scale, scale);
    ctx.translate(-cx, -cy);

    const radius = THUMB / 2;
    for (const pt of points) {
      const px = MARGIN + pt.nx * innerW;
      const py = MARGIN + pt.ny * innerH;
      const isSel = pt.path === selectedPath;
      const img = imgCacheRef.current.get(pt.path);
      ctx.save();
      ctx.beginPath();
      ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      if (img?.complete && img.naturalWidth > 0) {
        ctx.drawImage(img, px - radius, py - radius, THUMB, THUMB);
      } else {
        ctx.fillStyle = thumbFailedByPath[pt.path] ? "#d4d4d8" : "#f4f4f5";
        ctx.fillRect(px - radius, py - radius, THUMB, THUMB);
        const ext = pt.path.split(".").pop()?.slice(0, 4).toUpperCase() ?? "";
        ctx.fillStyle = "#71717a";
        ctx.font = "10px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(ext || "·", px, py);
      }
      ctx.restore();
      if (isSel) {
        ctx.strokeStyle = "rgba(239, 68, 68, 0.85)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(px, py, radius + 2, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    ctx.restore();
  }, [points, pan, scale, selectedPath, thumbByPath, thumbFailedByPath]);

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
    async (limit: number, algo: GraphLayoutAlgorithm) => {
      setLimitInput(String(limit));
      setAlgorithm(algo);
      setError(null);
      setLoading(true);
      setLayoutBusy(false);
      setPoints([]);
      try {
        const res = (await invoke("qdrant_scroll_content_vectors", {
          args: { sourceId: cfg.sourceId, limit },
        })) as { points: ContentPoint[] };

        if (res.points.length === 0) {
          setError("No indexed content vectors for this source. Index files in Settings first.");
          return;
        }

        const n = res.points.length;
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
    void runLoad(DEFAULT_LIMIT, "pca");
  }, [runLoad]);

  const loadAndLayout = useCallback(() => {
    void runLoad(parseLimitInput(limitInput), algorithm);
  }, [runLoad, limitInput, algorithm]);

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

      <div className="mb-3 flex flex-wrap items-end justify-start gap-3">
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
        <Button
          type="button"
          onClick={() => void loadAndLayout()}
          disabled={loading || layoutBusy}
          className="mt-5"
        >
          {loading || layoutBusy ? "Loading…" : "Load & layout"}
        </Button>
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
        <canvas
          ref={canvasRef}
          className="h-full w-full cursor-grab active:cursor-grabbing"
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
      </div>
    </section>
  );
}
