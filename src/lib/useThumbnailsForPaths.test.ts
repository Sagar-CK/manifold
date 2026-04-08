import { describe, expect, it } from "vitest";
import {
  isPreviewablePath,
  prioritizePaths,
  resolveThumbnailQueuePaths,
} from "@/lib/useThumbnailsForPaths";

describe("isPreviewablePath", () => {
  it("supports image, pdf, and current video thumbnail types", () => {
    expect(isPreviewablePath("/tmp/photo.png")).toBe(true);
    expect(isPreviewablePath("/tmp/photo.jpg")).toBe(true);
    expect(isPreviewablePath("/tmp/photo.jpeg")).toBe(true);
    expect(isPreviewablePath("/tmp/doc.pdf")).toBe(true);
    expect(isPreviewablePath("/tmp/clip.mp4")).toBe(true);
    expect(isPreviewablePath("/tmp/clip.mov")).toBe(true);
    expect(isPreviewablePath("/tmp/audio.wav")).toBe(false);
  });

  it("prioritizes requested paths without duplicating them", () => {
    expect(
      prioritizePaths(
        ["/tmp/a.png", "/tmp/b.png", "/tmp/c.png"],
        ["/tmp/c.png", "/tmp/a.png", "/tmp/c.png"],
      ),
    ).toEqual(["/tmp/c.png", "/tmp/a.png", "/tmp/b.png"]);
  });

  it("filters the queue down to requested preview paths and keeps priority paths first", () => {
    expect(
      resolveThumbnailQueuePaths(
        [
          "/tmp/a.png",
          "/tmp/b.png",
          "/tmp/c.pdf",
          "/tmp/offscreen.mov",
          "/tmp/audio.wav",
        ],
        ["/tmp/b.png", "/tmp/c.pdf"],
        ["/tmp/c.pdf"],
      ),
    ).toEqual(["/tmp/c.pdf", "/tmp/b.png"]);
  });
});
