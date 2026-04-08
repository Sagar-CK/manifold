type LayoutPointLike = {
  path: string;
  nx: number;
  ny: number;
};

export type GraphLodMode = "markers" | "placeholders" | "thumbnails";

export type GraphViewportMetrics = {
  width: number;
  height: number;
  innerW: number;
  innerH: number;
  cx: number;
  cy: number;
  margin: number;
};

type VisibleGraphPoint = {
  index: number;
  path: string;
  px: number;
  py: number;
  screenX: number;
  screenY: number;
  centerDistanceSq: number;
};

type ThumbnailDemand = {
  requestedPaths: string[];
  priorityPaths: string[];
};

const GRAPH_MARKER_ONLY_THRESHOLD = 800;
const GRAPH_THUMBNAIL_THRESHOLD = 250;
const GRAPH_PLACEHOLDER_PRIORITY_LIMIT = 80;
const GRAPH_PLACEHOLDER_MAX_REQUEST_LIMIT = 160;
const GRAPH_PLACEHOLDER_TARGET_RATIO = 0.6;

export function buildViewportMetrics(
  width: number,
  height: number,
  margin: number,
): GraphViewportMetrics {
  return {
    width,
    height,
    innerW: Math.max(0, width - 2 * margin),
    innerH: Math.max(0, height - 2 * margin),
    cx: width / 2,
    cy: height / 2,
    margin,
  };
}

export function buildSpatialGrid<T extends LayoutPointLike>(
  points: T[],
  dim: number,
): number[][] {
  const cells: number[][] = Array.from({ length: dim * dim }, () => []);
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const gx = Math.min(dim - 1, Math.max(0, Math.floor(p.nx * dim)));
    const gy = Math.min(dim - 1, Math.max(0, Math.floor(p.ny * dim)));
    cells[gx + gy * dim]!.push(i);
  }
  return cells;
}

export function chooseGraphLodMode(visiblePointCount: number): GraphLodMode {
  if (visiblePointCount > GRAPH_MARKER_ONLY_THRESHOLD) return "markers";
  if (visiblePointCount > GRAPH_THUMBNAIL_THRESHOLD) return "placeholders";
  return "thumbnails";
}

export function graphPointToScreenPoint(
  viewport: GraphViewportMetrics,
  panX: number,
  panY: number,
  scale: number,
  graphX: number,
  graphY: number,
): { x: number; y: number } {
  return {
    x: (graphX - viewport.cx) * scale + viewport.cx + panX,
    y: (graphY - viewport.cy) * scale + viewport.cy + panY,
  };
}

export function screenPointToGraphPoint(
  viewport: GraphViewportMetrics,
  panX: number,
  panY: number,
  scale: number,
  screenX: number,
  screenY: number,
): { x: number; y: number } {
  return {
    x: (screenX - viewport.cx - panX) / scale + viewport.cx,
    y: (screenY - viewport.cy - panY) / scale + viewport.cy,
  };
}

export function adjustPanForZoomAtScreenPoint(
  viewport: GraphViewportMetrics,
  panX: number,
  panY: number,
  currentScale: number,
  nextScale: number,
  screenX: number,
  screenY: number,
): { x: number; y: number } {
  const graphPoint = screenPointToGraphPoint(
    viewport,
    panX,
    panY,
    currentScale,
    screenX,
    screenY,
  );
  return {
    x: screenX - viewport.cx - (graphPoint.x - viewport.cx) * nextScale,
    y: screenY - viewport.cy - (graphPoint.y - viewport.cy) * nextScale,
  };
}

function collectVisibleIndices(
  bounds: { nx0: number; nx1: number; ny0: number; ny1: number },
  gridIndex: number[][],
  dim: number,
): number[] {
  const gx0 = Math.max(0, Math.floor(bounds.nx0 * dim));
  const gx1 = Math.min(dim - 1, Math.floor(bounds.nx1 * dim));
  const gy0 = Math.max(0, Math.floor(bounds.ny0 * dim));
  const gy1 = Math.min(dim - 1, Math.floor(bounds.ny1 * dim));
  const out: number[] = [];
  for (let gy = gy0; gy <= gy1; gy++) {
    for (let gx = gx0; gx <= gx1; gx++) {
      out.push(...gridIndex[gx + gy * dim]!);
    }
  }
  return out;
}

function normalizedVisibleBounds(
  viewport: GraphViewportMetrics,
  panX: number,
  panY: number,
  scale: number,
  padPx: number,
): { nx0: number; nx1: number; ny0: number; ny1: number } {
  const nxAt = (screenX: number) =>
    (screenPointToGraphPoint(viewport, panX, panY, scale, screenX, 0).x -
      viewport.margin) /
    viewport.innerW;
  const nyAt = (screenY: number) =>
    (screenPointToGraphPoint(viewport, panX, panY, scale, 0, screenY).y -
      viewport.margin) /
    viewport.innerH;
  const nxLo = Math.min(nxAt(-padPx), nxAt(viewport.width + padPx));
  const nxHi = Math.max(nxAt(-padPx), nxAt(viewport.width + padPx));
  const nyLo = Math.min(nyAt(-padPx), nyAt(viewport.height + padPx));
  const nyHi = Math.max(nyAt(-padPx), nyAt(viewport.height + padPx));
  const padN = 0.04;
  return {
    nx0: Math.max(0, nxLo - padN),
    nx1: Math.min(1, nxHi + padN),
    ny0: Math.max(0, nyLo - padN),
    ny1: Math.min(1, nyHi + padN),
  };
}

export function collectVisibleGraphPoints<T extends LayoutPointLike>(
  points: T[],
  gridIndex: number[][],
  dim: number,
  viewport: GraphViewportMetrics,
  panX: number,
  panY: number,
  scale: number,
  padPx: number,
): VisibleGraphPoint[] {
  if (points.length === 0 || viewport.innerW <= 0 || viewport.innerH <= 0) {
    return [];
  }
  const bounds = normalizedVisibleBounds(viewport, panX, panY, scale, padPx);
  const visibleIndices = collectVisibleIndices(bounds, gridIndex, dim);
  const visible: VisibleGraphPoint[] = [];
  for (const index of visibleIndices) {
    const point = points[index];
    if (!point) continue;
    const px = viewport.margin + point.nx * viewport.innerW;
    const py = viewport.margin + point.ny * viewport.innerH;
    const screenPoint = graphPointToScreenPoint(
      viewport,
      panX,
      panY,
      scale,
      px,
      py,
    );
    const screenX = screenPoint.x;
    const screenY = screenPoint.y;
    if (
      screenX < -padPx ||
      screenX > viewport.width + padPx ||
      screenY < -padPx ||
      screenY > viewport.height + padPx
    ) {
      continue;
    }
    visible.push({
      index,
      path: point.path,
      px,
      py,
      screenX,
      screenY,
      centerDistanceSq:
        (screenX - viewport.cx) * (screenX - viewport.cx) +
        (screenY - viewport.cy) * (screenY - viewport.cy),
    });
  }
  return visible;
}

function uniquePaths(paths: Iterable<string>): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const path of paths) {
    if (seen.has(path)) continue;
    seen.add(path);
    ordered.push(path);
  }
  return ordered;
}

function samplePathsEvenly(paths: string[], limit: number): string[] {
  if (limit >= paths.length) return paths;
  if (limit <= 0 || paths.length === 0) return [];
  const sampled: string[] = [];
  for (let i = 0; i < limit; i++) {
    const index = Math.floor((i * paths.length) / limit);
    sampled.push(paths[index]!);
  }
  return uniquePaths(sampled);
}

export function buildThumbnailDemand(
  visiblePoints: Pick<VisibleGraphPoint, "path" | "centerDistanceSq">[],
  lodMode: GraphLodMode,
  selectedPath: string | null,
  placeholderLimit: number = GRAPH_PLACEHOLDER_PRIORITY_LIMIT,
): ThumbnailDemand {
  const priorityPaths = selectedPath ? [selectedPath] : [];
  if (lodMode === "markers") {
    return {
      priorityPaths,
      requestedPaths: priorityPaths,
    };
  }

  const orderedVisiblePaths = uniquePaths(
    [...visiblePoints]
      .sort((a, b) => a.centerDistanceSq - b.centerDistanceSq)
      .map((point) => point.path),
  );

  const requestedVisiblePaths =
    lodMode === "thumbnails"
      ? orderedVisiblePaths
      : samplePathsEvenly(
          orderedVisiblePaths,
          Math.min(
            orderedVisiblePaths.length,
            Math.min(
              GRAPH_PLACEHOLDER_MAX_REQUEST_LIMIT,
              Math.max(
                placeholderLimit,
                Math.ceil(
                  orderedVisiblePaths.length * GRAPH_PLACEHOLDER_TARGET_RATIO,
                ),
              ),
            ),
          ),
        );

  return {
    priorityPaths,
    requestedPaths: uniquePaths([...priorityPaths, ...requestedVisiblePaths]),
  };
}
