import { ArrowLeft, CircleHelp } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ErrorMessage } from "@/components/ErrorMessage";
import { PageHeader } from "@/components/PageHeader";
import { TagFilterPill } from "@/components/TagFilterPill";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { qdrantScrollGraph } from "@/lib/api/tauri";
import { invokeErrorText } from "@/lib/errors";
import {
  adjustPanForZoomAtScreenPoint,
  buildSpatialGrid,
  buildThumbnailDemand,
  buildViewportMetrics,
  chooseGraphLodMode,
  collectVisibleGraphPoints,
  type GraphLodMode,
} from "@/lib/graphExplorerRendering";
import { type GraphLayoutAlgorithm, runGraphLayout } from "@/lib/graphLayout";
import { graphPerfMark, graphPerfSessionStart } from "@/lib/graphPerfDebug";
import type { LocalConfig } from "@/lib/localConfig";
import { navigateBackOrFallback } from "@/lib/navigateBack";
import { pruneIndexedPathIfMissing } from "@/lib/staleIndexedPaths";
import { useTagsState } from "@/lib/useTagsState";
import {
  isPreviewablePath,
  useThumbnailsForPaths,
} from "@/lib/useThumbnailsForPaths";

type ContentPoint = {
  path: string;
  contentHash: string;
  tagIds: string[];
  previewable: boolean;
  fallbackLabel: string;
};

type LayoutPoint = ContentPoint & {
  nx: number;
  ny: number;
};

type ThumbnailDemandState = {
  requestedPaths: string[];
  priorityPaths: string[];
  lodMode: GraphLodMode;
  visiblePointCount: number;
};

const THUMB = 22;
const MARGIN = 28;
const GRAPH_THUMB_MAX_EDGE = 64;
const GRID_DIM = 32;
const MAX_CANVAS_DPR = 2;
const GRAPH_THUMB_CONCURRENCY = 2;
const DEFAULT_LIMIT = 500;
const LIMIT_DEBOUNCE_MS = 350;
const HARD_WARN = 2000;
const UNTAGGED_RING = "#94a3b8";
const RING_MAX_SEGMENTS = 4;
const RING_OVERFLOW_COLOR = "#78716c";
const SELECTED_RING = "#71717a";
const RING_GAP_RAD = 0.1;
const LOADING_FILL = "#e4e4e7";
const PLACEHOLDER_FILL = "#f4f4f5";
const FAILED_FILL = "#d4d4d8";
const MARKER_FILL = "#94a3b8";
const GRAPH_SPRITE_EDGE = 64;
const THUMB_DRAW_MIN_MS = 100;
const THUMBNAIL_DEMAND_REFRESH_MS = 120;
const MIN_GRAPH_SCALE = 0.25;
const MAX_GRAPH_SCALE = 12;
const GRAPH_NODE_GROWTH_EXPONENT = 0.5;

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

function fallbackLabelForPath(path: string): string {
  return path.split(".").pop()?.slice(0, 4).toUpperCase() ?? "";
}

function strokeSegmentedTagRing(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  ringR: number,
  scale: number,
  colors: string[],
): void {
  ctx.lineWidth = 2 / scale;
  ctx.lineCap = "butt";

  if (colors.length === 0) {
    ctx.strokeStyle = UNTAGGED_RING;
    ctx.beginPath();
    ctx.arc(px, py, ringR, 0, Math.PI * 2);
    ctx.stroke();
    return;
  }

  if (colors.length === 1) {
    ctx.strokeStyle = colors[0]!;
    ctx.beginPath();
    ctx.arc(px, py, ringR, 0, Math.PI * 2);
    ctx.stroke();
    return;
  }

  const segments: string[] =
    colors.length <= RING_MAX_SEGMENTS
      ? colors
      : [...colors.slice(0, RING_MAX_SEGMENTS - 1), RING_OVERFLOW_COLOR];

  const n = segments.length;
  const gap = RING_GAP_RAD;
  const sweep = (2 * Math.PI - n * gap) / n;
  const startBase = -Math.PI / 2;

  for (let i = 0; i < n; i++) {
    const a0 = startBase + i * (sweep + gap);
    const a1 = a0 + sweep;
    ctx.strokeStyle = segments[i]!;
    ctx.beginPath();
    ctx.arc(px, py, ringR, a0, a1);
    ctx.stroke();
  }
}

function createSpriteCanvas(
  draw: (ctx: CanvasRenderingContext2D, size: number) => void,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = GRAPH_SPRITE_EDGE;
  canvas.height = GRAPH_SPRITE_EDGE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  draw(ctx, GRAPH_SPRITE_EDGE);
  return canvas;
}

function createThumbnailSprite(img: CanvasImageSource): HTMLCanvasElement {
  return createSpriteCanvas((ctx, size) => {
    ctx.save();
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(img, 0, 0, size, size);
    ctx.restore();
  });
}

function createTextSprite(
  fill: string,
  label: string,
  textColor: string,
): HTMLCanvasElement {
  return createSpriteCanvas((ctx, size) => {
    ctx.save();
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, size, size);
    ctx.restore();
    if (label.length === 0) return;
    ctx.fillStyle = textColor;
    ctx.font = `${Math.round(size * 0.36)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, size / 2, size / 2);
  });
}

function defaultThumbnailDemand(): ThumbnailDemandState {
  return {
    requestedPaths: [],
    priorityPaths: [],
    lodMode: "markers",
    visiblePointCount: 0,
  };
}

function graphNodeZoomFactor(scale: number): number {
  // Grow previews more slowly than the graph itself so zoom increases separability.
  return scale ** GRAPH_NODE_GROWTH_EXPONENT;
}

function graphNodeScreenRadius(scale: number): number {
  return (THUMB * graphNodeZoomFactor(scale)) / 2;
}

function graphVisibilityPad(scale: number): number {
  return graphNodeScreenRadius(scale) + 10;
}

export function GraphExplorerPage({ cfg }: { cfg: LocalConfig }) {
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const pointsRef = useRef<LayoutPoint[]>([]);
  const gridRef = useRef<number[][]>([]);
  const pathSetRef = useRef<Set<string>>(new Set());
  const viewportRef = useRef(buildViewportMetrics(0, 0, MARGIN));
  const loadGenerationRef = useRef(0);
  const graphEffectIdRef = useRef(0);
  const drawRef = useRef<() => void>(() => {});
  const selectedPathRef = useRef<string | null>(null);
  const thumbnailDemandRef = useRef<ThumbnailDemandState>(
    defaultThumbnailDemand(),
  );
  const lastThumbnailDemandKeyRef = useRef("");
  const thumbnailDemandTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const spriteGenerationRef = useRef(0);
  const drawRafRef = useRef<number | null>(null);
  const wheelScaleRafRef = useRef<number | null>(null);
  const thumbDrawTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const lastThumbPaintAtRef = useRef(0);
  const firstMarkersMarkRef = useRef(false);
  const firstThumbnailsMarkRef = useRef(false);
  const dragActiveRef = useRef(false);
  const dragRef = useRef<{
    active: boolean;
    sx: number;
    sy: number;
    px: number;
    py: number;
  } | null>(null);
  const spriteCacheRef = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const fallbackSpriteCacheRef = useRef<Map<string, HTMLCanvasElement>>(
    new Map(),
  );

  const [limitInput, setLimitInput] = useState(String(DEFAULT_LIMIT));
  const [debouncedLimitInput, setDebouncedLimitInput] = useState(
    String(DEFAULT_LIMIT),
  );
  const [selectedAlgorithm, setSelectedAlgorithm] =
    useState<GraphLayoutAlgorithm>("pca");
  const [activeAlgorithm, setActiveAlgorithm] =
    useState<GraphLayoutAlgorithm>("pca");
  const [tagFilterIds, setTagFilterIds] = useState<string[]>([]);
  const [tagsState] = useTagsState();
  const [points, setPoints] = useState<LayoutPoint[]>([]);
  const [pointCount, setPointCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [layoutBusy, setLayoutBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noResults, setNoResults] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const [thumbnailDemand, setThumbnailDemand] = useState<ThumbnailDemandState>(
    defaultThumbnailDemand(),
  );
  const [loadRequest, setLoadRequest] = useState<{
    limit: number;
    algo: GraphLayoutAlgorithm;
    tagFilters: string[];
  } | null>(null);

  const panRef = useRef(pan);
  const scaleRef = useRef(scale);

  pointsRef.current = points;
  selectedPathRef.current = selectedPath;
  thumbnailDemandRef.current = thumbnailDemand;

  const paths = useMemo(() => points.map((p) => p.path), [points]);
  const pathsKey = useMemo(() => paths.slice().sort().join("\0"), [paths]);
  pathSetRef.current = new Set(paths);

  const gridIndex = useMemo(() => buildSpatialGrid(points, GRID_DIM), [points]);
  gridRef.current = gridIndex;

  const ringColorsByIndex = useMemo(() => {
    const tagMap = new Map(tagsState.tags.map((tag) => [tag.id, tag.color]));
    return points.map((point) => {
      const colors: string[] = [];
      for (const tagId of point.tagIds) {
        const color = tagMap.get(tagId);
        if (color) colors.push(color);
      }
      return colors;
    });
  }, [points, tagsState.tags]);

  const requestedThumbnailPathSet = useMemo(
    () => new Set(thumbnailDemand.requestedPaths),
    [thumbnailDemand.requestedPaths],
  );

  const { thumbByPath, thumbFailedByPath } = useThumbnailsForPaths(
    pathsKey,
    paths,
    {
      maxEdge: GRAPH_THUMB_MAX_EDGE,
      batchUpdates: true,
      concurrency: GRAPH_THUMB_CONCURRENCY,
      deferStartUntilIdle: true,
      requestedPaths: thumbnailDemand.requestedPaths,
      priorityPaths: thumbnailDemand.priorityPaths,
      onThumbError: (path, error) => {
        void pruneIndexedPathIfMissing(cfg.sourceId, path, error).catch(
          () => {},
        );
      },
    },
  );

  const requestGraphLoad = useCallback(
    (limit: number, algo: GraphLayoutAlgorithm, tagFilters: string[]) => {
      setActiveAlgorithm(algo);
      setLoadRequest({
        limit,
        algo,
        tagFilters: [...tagFilters],
      });
    },
    [],
  );

  const getFallbackSprite = useCallback(
    (key: string, fill: string, label: string, textColor: string) => {
      const cached = fallbackSpriteCacheRef.current.get(key);
      if (cached) return cached;
      const sprite = createTextSprite(fill, label, textColor);
      fallbackSpriteCacheRef.current.set(key, sprite);
      return sprite;
    },
    [],
  );

  const resolvePointSprite = useCallback(
    (
      point: LayoutPoint,
      fullDetail: boolean,
      failed: boolean,
    ): HTMLCanvasElement => {
      if (fullDetail) {
        const sprite = spriteCacheRef.current.get(point.path);
        if (sprite) return sprite;
        if (failed) {
          return getFallbackSprite(
            `failed:${point.fallbackLabel}`,
            FAILED_FILL,
            point.fallbackLabel || "·",
            "#71717a",
          );
        }
        if (!point.previewable) {
          return getFallbackSprite(
            `static:${point.fallbackLabel}`,
            PLACEHOLDER_FILL,
            point.fallbackLabel || "·",
            "#71717a",
          );
        }
        return getFallbackSprite("loading", LOADING_FILL, "…", "#a1a1aa");
      }

      return getFallbackSprite("placeholder-neutral", PLACEHOLDER_FILL, "", "");
    },
    [getFallbackSprite],
  );

  const computeThumbnailDemand = useCallback((): ThumbnailDemandState => {
    const visible = collectVisibleGraphPoints(
      pointsRef.current,
      gridRef.current,
      GRID_DIM,
      viewportRef.current,
      panRef.current.x,
      panRef.current.y,
      scaleRef.current,
      graphVisibilityPad(scaleRef.current),
    );
    const lodMode = chooseGraphLodMode(visible.length);
    const demand = buildThumbnailDemand(
      visible,
      lodMode,
      selectedPathRef.current,
    );
    return {
      requestedPaths: demand.requestedPaths,
      priorityPaths: demand.priorityPaths,
      lodMode,
      visiblePointCount: visible.length,
    };
  }, []);

  const applyThumbnailDemand = useCallback(() => {
    const next = computeThumbnailDemand();
    const key = [
      next.lodMode,
      String(next.visiblePointCount),
      next.priorityPaths.join("\0"),
      next.requestedPaths.join("\0"),
    ].join("\u0001");
    if (key === lastThumbnailDemandKeyRef.current) return;
    lastThumbnailDemandKeyRef.current = key;
    setThumbnailDemand(next);
    graphPerfMark("visible_snapshot", {
      visible_point_count: next.visiblePointCount,
      requested_thumbnail_count: next.requestedPaths.length,
      lod_mode: next.lodMode,
    });
  }, [computeThumbnailDemand]);

  const refreshThumbnailDemand = useCallback(
    (immediate: boolean = false) => {
      if (immediate) {
        if (thumbnailDemandTimeoutRef.current != null) {
          clearTimeout(thumbnailDemandTimeoutRef.current);
          thumbnailDemandTimeoutRef.current = null;
        }
        applyThumbnailDemand();
        return;
      }
      if (thumbnailDemandTimeoutRef.current != null) return;
      thumbnailDemandTimeoutRef.current = setTimeout(() => {
        thumbnailDemandTimeoutRef.current = null;
        applyThumbnailDemand();
      }, THUMBNAIL_DEMAND_REFRESH_MS);
    },
    [applyThumbnailDemand],
  );

  useEffect(() => {
    if (!dragActiveRef.current) {
      panRef.current = pan;
    }
  }, [pan]);

  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);

  useEffect(() => {
    const activePaths = new Set(paths);
    for (const key of [...spriteCacheRef.current.keys()]) {
      if (!activePaths.has(key)) spriteCacheRef.current.delete(key);
    }
  }, [paths]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const viewport = viewportRef.current;
    if (viewport.width <= 0 || viewport.height <= 0) return;

    ctx.clearRect(0, 0, viewport.width, viewport.height);

    const panX = panRef.current.x;
    const panY = panRef.current.y;
    const sc = scaleRef.current;
    const visible = collectVisibleGraphPoints(
      points,
      gridIndex,
      GRID_DIM,
      viewport,
      panX,
      panY,
      sc,
      graphVisibilityPad(sc),
    );
    const lodMode = chooseGraphLodMode(visible.length);

    ctx.save();
    ctx.translate(viewport.cx + panX, viewport.cy + panY);
    ctx.scale(sc, sc);
    ctx.translate(-viewport.cx, -viewport.cy);

    const radius = graphNodeScreenRadius(sc) / sc;
    const size = radius * 2;
    const markerRadius = 3 / sc;
    const tagRingExtra = 2.5 / sc;
    let drewAnyPoint = false;
    let drewActualThumbnail = false;

    for (const visiblePoint of visible) {
      const point = points[visiblePoint.index];
      if (!point) continue;
      drewAnyPoint = true;
      const isSelected = point.path === selectedPath;

      if (lodMode === "markers" && !isSelected) {
        ctx.fillStyle = MARKER_FILL;
        ctx.beginPath();
        ctx.arc(visiblePoint.px, visiblePoint.py, markerRadius, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }

      strokeSegmentedTagRing(
        ctx,
        visiblePoint.px,
        visiblePoint.py,
        radius + tagRingExtra,
        sc,
        ringColorsByIndex[visiblePoint.index] ?? [],
      );

      const hasLoadedSprite = spriteCacheRef.current.has(point.path);
      const fullDetail =
        hasLoadedSprite ||
        isSelected ||
        lodMode === "thumbnails" ||
        (lodMode === "placeholders" &&
          requestedThumbnailPathSet.has(point.path));
      const sprite = resolvePointSprite(
        point,
        fullDetail,
        !!thumbFailedByPath[point.path],
      );
      ctx.drawImage(
        sprite,
        visiblePoint.px - radius,
        visiblePoint.py - radius,
        size,
        size,
      );

      if (hasLoadedSprite) {
        drewActualThumbnail = true;
      }

      if (isSelected) {
        ctx.strokeStyle = SELECTED_RING;
        ctx.lineWidth = 2.5 / sc;
        ctx.beginPath();
        ctx.arc(
          visiblePoint.px,
          visiblePoint.py,
          radius + tagRingExtra + 2 / sc,
          0,
          Math.PI * 2,
        );
        ctx.stroke();
      }
    }

    ctx.restore();

    if (!firstMarkersMarkRef.current && drewAnyPoint) {
      firstMarkersMarkRef.current = true;
      graphPerfMark("time_to_first_markers", {
        visible_point_count: visible.length,
        requested_thumbnail_count:
          thumbnailDemandRef.current.requestedPaths.length,
        lod_mode: lodMode,
      });
    }
    if (!firstThumbnailsMarkRef.current && drewActualThumbnail) {
      firstThumbnailsMarkRef.current = true;
      graphPerfMark("time_to_first_thumbnails", {
        visible_point_count: visible.length,
        requested_thumbnail_count:
          thumbnailDemandRef.current.requestedPaths.length,
        lod_mode: lodMode,
      });
    }
  }, [
    gridIndex,
    points,
    resolvePointSprite,
    ringColorsByIndex,
    requestedThumbnailPathSet,
    selectedPath,
    thumbFailedByPath,
  ]);

  drawRef.current = draw;

  const scheduleDraw = useCallback(() => {
    if (drawRafRef.current != null) return;
    drawRafRef.current = requestAnimationFrame(() => {
      drawRafRef.current = null;
      drawRef.current();
    });
  }, []);

  const scheduleDrawAfterThumb = useCallback(() => {
    const now = performance.now();
    if (now - lastThumbPaintAtRef.current >= THUMB_DRAW_MIN_MS) {
      lastThumbPaintAtRef.current = now;
      scheduleDraw();
      return;
    }
    if (thumbDrawTimeoutRef.current != null) return;
    const delay = Math.max(
      8,
      THUMB_DRAW_MIN_MS - (now - lastThumbPaintAtRef.current),
    );
    thumbDrawTimeoutRef.current = setTimeout(() => {
      thumbDrawTimeoutRef.current = null;
      lastThumbPaintAtRef.current = performance.now();
      scheduleDraw();
    }, delay);
  }, [scheduleDraw]);

  const syncViewport = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const rect = wrap.getBoundingClientRect();
    viewportRef.current = buildViewportMetrics(rect.width, rect.height, MARGIN);
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_CANVAS_DPR);
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    scheduleDraw();
    refreshThumbnailDemand(true);
  }, [refreshThumbnailDemand, scheduleDraw]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    return () => {
      if (drawRafRef.current != null) {
        cancelAnimationFrame(drawRafRef.current);
        drawRafRef.current = null;
      }
      if (wheelScaleRafRef.current != null) {
        cancelAnimationFrame(wheelScaleRafRef.current);
        wheelScaleRafRef.current = null;
      }
      if (thumbDrawTimeoutRef.current != null) {
        clearTimeout(thumbDrawTimeoutRef.current);
        thumbDrawTimeoutRef.current = null;
      }
      if (thumbnailDemandTimeoutRef.current != null) {
        clearTimeout(thumbnailDemandTimeoutRef.current);
        thumbnailDemandTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const generation = ++spriteGenerationRef.current;
    for (const path of thumbnailDemand.requestedPaths) {
      const url = thumbByPath[path];
      if (!url || spriteCacheRef.current.has(path)) continue;
      const img = new Image();
      img.decoding = "async";
      img.src = url;
      img.onload = () => {
        if (generation !== spriteGenerationRef.current) return;
        if (!pathSetRef.current.has(path)) return;
        spriteCacheRef.current.set(path, createThumbnailSprite(img));
        scheduleDrawAfterThumb();
      };
    }
  }, [scheduleDrawAfterThumb, thumbByPath, thumbnailDemand.requestedPaths]);

  useEffect(() => {
    const ro = new ResizeObserver(() => {
      syncViewport();
    });
    if (wrapRef.current) {
      ro.observe(wrapRef.current);
      syncViewport();
    }
    return () => ro.disconnect();
  }, [syncViewport]);

  useEffect(() => {
    refreshThumbnailDemand(true);
  }, [points, gridIndex, selectedPath, refreshThumbnailDemand]);

  const runLoad = useCallback(
    async (
      limit: number,
      algo: GraphLayoutAlgorithm,
      tagFilters: string[],
      effectId: number,
    ) => {
      const gen = ++loadGenerationRef.current;
      graphPerfSessionStart();
      graphPerfMark("load_start", {
        limit,
        algo,
        tag_filter_count: tagFilters.length,
      });
      setLimitInput(String(limit));
      setError(null);
      setNoResults(false);
      setLoading(true);
      setLayoutBusy(false);
      setPoints([]);
      setPointCount(null);
      selectedPathRef.current = null;
      setSelectedPath(null);
      setThumbnailDemand(defaultThumbnailDemand());
      lastThumbnailDemandKeyRef.current = "";
      firstMarkersMarkRef.current = false;
      firstThumbnailsMarkRef.current = false;
      lastThumbPaintAtRef.current = 0;
      spriteGenerationRef.current += 1;
      if (thumbDrawTimeoutRef.current != null) {
        clearTimeout(thumbDrawTimeoutRef.current);
        thumbDrawTimeoutRef.current = null;
      }

      try {
        const res = await qdrantScrollGraph({
          sourceId: cfg.sourceId,
          limit,
          tagFilterIds: tagFilters.length > 0 ? tagFilters : undefined,
        });

        if (gen !== loadGenerationRef.current) return;
        if (effectId !== graphEffectIdRef.current) return;

        graphPerfMark("invoke_qdrant_scroll_graph_done", {
          n: res.n,
          d: res.d,
          packed_base64_chars: res.packedEmbeddingsF32Base64.length,
          limit,
          algo,
        });

        if (res.n === 0) {
          graphPerfMark("no_results");
          setNoResults(true);
          return;
        }

        setPointCount(res.n);
        setLayoutBusy(true);
        graphPerfMark("worker_decode_start", { algo, n: res.n, d: res.d });
        graphPerfMark("runGraphLayout_worker_start", {
          algo,
          n: res.n,
          d: res.d,
        });
        const layout = await runGraphLayout(
          res.packedEmbeddingsF32Base64,
          res.n,
          res.d,
          algo,
        );
        if (gen !== loadGenerationRef.current) return;
        if (effectId !== graphEffectIdRef.current) return;

        graphPerfMark("worker_decode_done", {
          decode_ms: Number(layout.metrics.decodeMs.toFixed(2)),
          row_conversion_ms: Number(layout.metrics.rowConversionMs.toFixed(2)),
        });
        graphPerfMark("runGraphLayout_worker_done", {
          layout_ms: Number(layout.metrics.layoutMs.toFixed(2)),
          normalize_ms: Number(layout.metrics.normalizeMs.toFixed(2)),
        });

        const next: LayoutPoint[] = res.points.map((point, index) => ({
          path: point.path,
          contentHash: point.contentHash,
          tagIds: point.tagIds,
          previewable: isPreviewablePath(point.path),
          fallbackLabel: fallbackLabelForPath(point.path),
          nx: layout.x[index] ?? 0,
          ny: layout.y[index] ?? 0,
        }));
        setPoints(next);
        graphPerfMark("setPoints_done", { layout_points: next.length });
        dragActiveRef.current = false;
        setPan({ x: 0, y: 0 });
        setScale(1);
        panRef.current = { x: 0, y: 0 };
        scaleRef.current = 1;
      } catch (e) {
        if (gen !== loadGenerationRef.current) return;
        if (e instanceof Error && e.message === "Graph layout superseded") {
          graphPerfMark("run_superseded");
          return;
        }
        graphPerfMark("load_error", {
          message: e instanceof Error ? e.message : String(e),
        });
        setError(invokeErrorText(e));
      } finally {
        if (gen === loadGenerationRef.current) {
          graphPerfMark("load_pipeline_finally_ui_idle");
          setLoading(false);
          setLayoutBusy(false);
        }
      }
    },
    [cfg.sourceId],
  );

  useEffect(() => {
    const id = window.setTimeout(
      () => setDebouncedLimitInput(limitInput),
      LIMIT_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(id);
  }, [limitInput]);

  useEffect(() => {
    requestGraphLoad(
      parseLimitInput(debouncedLimitInput),
      selectedAlgorithm,
      tagFilterIds,
    );
  }, [debouncedLimitInput, requestGraphLoad, selectedAlgorithm, tagFilterIds]);

  useEffect(() => {
    if (!loadRequest) return;
    const effectId = ++graphEffectIdRef.current;
    void runLoad(
      loadRequest.limit,
      loadRequest.algo,
      loadRequest.tagFilters,
      effectId,
    );
  }, [loadRequest, runLoad]);

  const hitTest = useCallback(
    (screenX: number, screenY: number): string | null => {
      const currentScale = scaleRef.current;
      const visible = collectVisibleGraphPoints(
        pointsRef.current,
        gridRef.current,
        GRID_DIM,
        viewportRef.current,
        panRef.current.x,
        panRef.current.y,
        currentScale,
        graphVisibilityPad(currentScale) + 4,
      );
      const hitRadius = graphNodeScreenRadius(currentScale) + 4;
      const hitRadiusSq = hitRadius * hitRadius;
      for (let i = visible.length - 1; i >= 0; i--) {
        const point = visible[i]!;
        const dx = screenX - point.screenX;
        const dy = screenY - point.screenY;
        if (dx * dx + dy * dy <= hitRadiusSq) {
          return point.path;
        }
      }
      return null;
    },
    [],
  );

  function endPanDrag() {
    dragActiveRef.current = false;
    dragRef.current = null;
    setPan({ ...panRef.current });
    refreshThumbnailDemand(true);
  }

  const limitParsed = parseLimitInput(limitInput);
  const selectedAlgorithmOption: AlgorithmOption | null =
    ALGORITHM_OPTIONS.find((option) => option.value === selectedAlgorithm) ??
    ALGORITHM_OPTIONS[0];

  function toggleTagFilter(id: string) {
    setTagFilterIds((prev) =>
      prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id],
    );
  }

  return (
    <section className="flex h-full min-h-0 flex-col">
      <div className="relative shrink-0">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute left-0 top-0 text-muted-foreground"
              aria-label="Back"
              onClick={() => navigateBackOrFallback(navigate)}
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Back</TooltipContent>
        </Tooltip>
        <PageHeader
          heading="Graph explorer"
          subtitle="visualize your network of files"
        />
      </div>

      <div className="mb-3 flex flex-col gap-3">
        <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
          <div className="flex flex-col gap-1 text-left">
            <Label htmlFor="graph-limit-input" className="app-label">
              Limit
            </Label>
            <Input
              id="graph-limit-input"
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
          </div>
          <div className="flex flex-col gap-1 text-left">
            <div className="relative w-fit pr-5">
              <Label htmlFor="graph-algorithm-combobox" className="app-label">
                Algorithm
              </Label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="absolute top-1/2 right-0 inline-flex size-3.5 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                    aria-label="About layout algorithms"
                  >
                    <CircleHelp className="size-3.5" aria-hidden="true" />
                  </button>
                </TooltipTrigger>
                <TooltipContent
                  side="top"
                  className="max-w-64 items-start text-left"
                >
                  <div className="flex flex-col gap-1">
                    <p className="font-medium">Layout algorithms</p>
                    <p>
                      PCA is fastest. UMAP and t-SNE can reveal tighter local
                      clusters, but they usually take longer to compute.
                    </p>
                  </div>
                </TooltipContent>
              </Tooltip>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Combobox<AlgorithmOption>
                value={selectedAlgorithmOption}
                onValueChange={(value) => {
                  if (!value || value.value === selectedAlgorithm) return;
                  setSelectedAlgorithm(value.value);
                  setDebouncedLimitInput(limitInput);
                }}
              >
                <ComboboxInput
                  id="graph-algorithm-combobox"
                  readOnly
                  showClear={false}
                  aria-label="Layout algorithm"
                  className="w-40"
                />
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
            </div>
          </div>
          <div className="flex min-w-[12rem] max-w-full flex-1 flex-col gap-1 text-left">
            <span className="app-label">Filter by tags (OR)</span>
            {tagsState.tags.length === 0 ? (
              <p className="text-xs leading-9 text-muted-foreground">
                Define tags in Settings to filter this view.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {tagsState.tags.map((tag) => {
                  const pressed = tagFilterIds.includes(tag.id);
                  return (
                    <TagFilterPill
                      key={tag.id}
                      tag={tag}
                      pressed={pressed}
                      onPressedChange={() => toggleTagFilter(tag.id)}
                      ariaLabel={`Filter by tag ${tag.name}`}
                    />
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {limitParsed > HARD_WARN ? (
        <p className="app-muted mb-2 text-center text-xs">
          Large limits may freeze the browser during layout. Consider{" "}
          {HARD_WARN} or fewer.
        </p>
      ) : null}

      <div
        ref={wrapRef}
        className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-border/70 bg-muted/20"
      >
        {loading || layoutBusy ? (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-4">
            <Spinner className="size-8 text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-4">
            <ErrorMessage
              variant="centered"
              className="max-w-md"
              message={error}
            />
          </div>
        ) : noResults ? (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-4">
            <Empty className="max-w-md border-none bg-transparent p-0">
              <EmptyHeader>
                <EmptyTitle>No results for the current filters</EmptyTitle>
                <EmptyDescription>
                  Try increasing the limit or removing some tag filters.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </div>
        ) : null}
        <canvas
          ref={canvasRef}
          className="relative z-[2] h-full w-full cursor-grab active:cursor-grabbing"
          role="img"
          aria-label="Embedding graph"
          onPointerDown={(e) => {
            (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
            dragActiveRef.current = true;
            dragRef.current = {
              active: true,
              sx: e.clientX,
              sy: e.clientY,
              px: panRef.current.x,
              py: panRef.current.y,
            };
          }}
          onPointerMove={(e) => {
            const drag = dragRef.current;
            if (!drag?.active) return;
            panRef.current = {
              x: drag.px + (e.clientX - drag.sx),
              y: drag.py + (e.clientY - drag.sy),
            };
            scheduleDraw();
            refreshThumbnailDemand();
          }}
          onPointerUp={(e) => {
            (e.target as HTMLCanvasElement).releasePointerCapture(e.pointerId);
            endPanDrag();
          }}
          onPointerLeave={(e) => {
            try {
              (e.target as HTMLCanvasElement).releasePointerCapture(
                e.pointerId,
              );
            } catch {
              /* noop */
            }
            if (dragRef.current?.active) {
              endPanDrag();
            }
          }}
          onWheel={(e) => {
            e.preventDefault();
            const rect = e.currentTarget.getBoundingClientRect();
            const screenX = e.clientX - rect.left;
            const screenY = e.clientY - rect.top;
            const currentScale = scaleRef.current;
            const delta = e.deltaY > 0 ? 0.92 : 1.08;
            const nextScale = Math.min(
              MAX_GRAPH_SCALE,
              Math.max(MIN_GRAPH_SCALE, currentScale * delta),
            );
            if (nextScale === currentScale) return;
            panRef.current = adjustPanForZoomAtScreenPoint(
              viewportRef.current,
              panRef.current.x,
              panRef.current.y,
              currentScale,
              nextScale,
              screenX,
              screenY,
            );
            scaleRef.current = nextScale;
            scheduleDraw();
            refreshThumbnailDemand();
            if (wheelScaleRafRef.current == null) {
              wheelScaleRafRef.current = requestAnimationFrame(() => {
                wheelScaleRafRef.current = null;
                setPan({ ...panRef.current });
                setScale(scaleRef.current);
                refreshThumbnailDemand(true);
              });
            }
          }}
          onClick={(e) => {
            const path = hitTest(e.nativeEvent.offsetX, e.nativeEvent.offsetY);
            if (!path) {
              selectedPathRef.current = null;
              setSelectedPath(null);
              refreshThumbnailDemand(true);
              return;
            }
            selectedPathRef.current = path;
            setSelectedPath(path);
            refreshThumbnailDemand(true);
            if (e.detail === 2) {
              navigate(`/file?path=${encodeURIComponent(path)}`, {
                state: { returnTo: "/graph" },
              });
            }
          }}
        />
        {points.length > 0 ? (
          <div className="pointer-events-none absolute bottom-2 left-2 rounded-lg border border-border/70 bg-background/90 px-2 py-1 text-[10px] text-muted-foreground shadow-xs backdrop-blur-sm">
            Drag to pan · wheel to zoom · click select · double-click open
          </div>
        ) : null}
        {pointCount !== null && !error ? (
          <div className="pointer-events-none absolute bottom-2 right-2 rounded-lg border border-border/70 bg-background/90 px-2 py-1 text-[10px] text-muted-foreground shadow-xs backdrop-blur-sm">
            {pointCount} point{pointCount === 1 ? "" : "s"} ·{" "}
            {activeAlgorithm.toUpperCase()}
          </div>
        ) : null}
      </div>
    </section>
  );
}
