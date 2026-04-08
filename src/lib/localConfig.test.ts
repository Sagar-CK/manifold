import { describe, expect, it } from "vitest";
import {
  collapseIncludeFolders,
  createDefaultLocalConfig,
  normalizeLocalConfig,
} from "@/lib/localConfig";

describe("collapseIncludeFolders", () => {
  it("removes nested include roots when a parent folder is already present", () => {
    expect(
      collapseIncludeFolders([
        "/Users/me/projects",
        "/Users/me/projects/app",
        "/Users/me/projects/app/src",
      ]),
    ).toEqual(["/Users/me/projects"]);
  });
});

describe("normalizeLocalConfig", () => {
  it("clamps invalid numeric values and fills missing defaults", () => {
    const cfg = normalizeLocalConfig({
      scoreThreshold: 99,
      topK: -10,
      include: ["/Users/me/projects/app", "/Users/me/projects"],
    });

    expect(cfg.scoreThreshold).toBe(1);
    expect(cfg.topK).toBe(1);
    expect(cfg.include).toEqual(["/Users/me/projects"]);
    expect(cfg.autoTaggingEnabled).toBe(true);
    expect(cfg.useDefaultFolderExcludes).toBe(true);
  });

  it("defaults image embedding to the faster preset", () => {
    expect(createDefaultLocalConfig().embeddingImagePreset).toBe("fast");
  });
});
