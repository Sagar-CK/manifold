import { describe, expect, it } from "vitest";
import {
  adjustPanForZoomAtScreenPoint,
  buildThumbnailDemand,
  buildViewportMetrics,
  chooseGraphLodMode,
  graphPointToScreenPoint,
  screenPointToGraphPoint,
} from "@/lib/graphExplorerRendering";

describe("chooseGraphLodMode", () => {
  it("switches between thumbnail, placeholder, and marker modes at the expected thresholds", () => {
    expect(chooseGraphLodMode(250)).toBe("thumbnails");
    expect(chooseGraphLodMode(251)).toBe("placeholders");
    expect(chooseGraphLodMode(800)).toBe("placeholders");
    expect(chooseGraphLodMode(801)).toBe("markers");
  });
});

describe("buildThumbnailDemand", () => {
  it("requests the selected path first and keeps visible thumbnails ordered by center distance", () => {
    const demand = buildThumbnailDemand(
      [
        { path: "/tmp/c.png", centerDistanceSq: 400 },
        { path: "/tmp/a.png", centerDistanceSq: 100 },
        { path: "/tmp/b.png", centerDistanceSq: 225 },
      ],
      "thumbnails",
      "/tmp/selected.png",
    );

    expect(demand.priorityPaths).toEqual(["/tmp/selected.png"]);
    expect(demand.requestedPaths).toEqual([
      "/tmp/selected.png",
      "/tmp/a.png",
      "/tmp/b.png",
      "/tmp/c.png",
    ]);
  });

  it("limits placeholder requests to the most central visible paths", () => {
    const visiblePoints = Array.from({ length: 90 }, (_, index) => ({
      path: `/tmp/${index}.png`,
      centerDistanceSq: index,
    }));

    const demand = buildThumbnailDemand(
      visiblePoints,
      "placeholders",
      "/tmp/selected.png",
    );

    expect(demand.requestedPaths).toHaveLength(81);
    expect(demand.requestedPaths[0]).toBe("/tmp/selected.png");
    expect(demand.requestedPaths[demand.requestedPaths.length - 1]).toBe(
      "/tmp/88.png",
    );
    expect(demand.requestedPaths).not.toContain("/tmp/89.png");
  });

  it("samples placeholder requests across the full visible range when many points are on screen", () => {
    const visiblePoints = Array.from({ length: 300 }, (_, index) => ({
      path: `/tmp/${index}.png`,
      centerDistanceSq: index,
    }));

    const demand = buildThumbnailDemand(
      visiblePoints,
      "placeholders",
      "/tmp/selected.png",
    );

    expect(demand.requestedPaths).toHaveLength(161);
    expect(demand.requestedPaths).toContain("/tmp/0.png");
    expect(demand.requestedPaths).toContain("/tmp/150.png");
    expect(demand.requestedPaths).toContain("/tmp/298.png");
    expect(demand.requestedPaths).not.toContain("/tmp/299.png");
  });

  it("only requests the selected path in marker mode", () => {
    const demand = buildThumbnailDemand(
      [{ path: "/tmp/a.png", centerDistanceSq: 10 }],
      "markers",
      "/tmp/selected.png",
    );

    expect(demand.requestedPaths).toEqual(["/tmp/selected.png"]);
  });
});

describe("graph coordinate transforms", () => {
  it("round-trips between graph and screen space", () => {
    const viewport = buildViewportMetrics(480, 320, 28);
    const screenPoint = graphPointToScreenPoint(
      viewport,
      72,
      -34,
      1.75,
      140,
      196,
    );
    const graphPoint = screenPointToGraphPoint(
      viewport,
      72,
      -34,
      1.75,
      screenPoint.x,
      screenPoint.y,
    );

    expect(graphPoint.x).toBeCloseTo(140, 6);
    expect(graphPoint.y).toBeCloseTo(196, 6);
  });

  it("keeps the hovered graph point pinned while zooming with pan applied", () => {
    const viewport = buildViewportMetrics(480, 320, 28);
    const point = { x: 156, y: 204 };
    const pan = { x: 68, y: -42 };
    const currentScale = 1.3;
    const nextScale = 2.4;
    const anchor = graphPointToScreenPoint(
      viewport,
      pan.x,
      pan.y,
      currentScale,
      point.x,
      point.y,
    );

    const nextPan = adjustPanForZoomAtScreenPoint(
      viewport,
      pan.x,
      pan.y,
      currentScale,
      nextScale,
      anchor.x,
      anchor.y,
    );
    const nextAnchor = graphPointToScreenPoint(
      viewport,
      nextPan.x,
      nextPan.y,
      nextScale,
      point.x,
      point.y,
    );

    expect(nextAnchor.x).toBeCloseTo(anchor.x, 6);
    expect(nextAnchor.y).toBeCloseTo(anchor.y, 6);
  });
});
