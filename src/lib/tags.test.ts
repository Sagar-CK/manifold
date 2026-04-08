import { describe, expect, it } from "vitest";
import {
  acceptPendingAutoTag,
  removePathEverywhere,
  removeTagEverywhere,
  type TagsState,
  togglePathTag,
} from "@/lib/tags";

const baseState: TagsState = {
  tags: [
    { id: "tag-a", name: "Review", color: "#111111" },
    { id: "tag-b", name: "Later", color: "#222222" },
  ],
  pathToTagIds: {
    "/tmp/file-a.png": ["tag-a"],
  },
  pendingAutoTags: {
    "/tmp/file-b.png": ["tag-b"],
  },
};

describe("togglePathTag", () => {
  it("adds a tag when missing and removes matching pending suggestions", () => {
    const next = togglePathTag(baseState, "/tmp/file-b.png", "tag-b");
    expect(next.pathToTagIds["/tmp/file-b.png"]).toEqual(["tag-b"]);
    expect(next.pendingAutoTags["/tmp/file-b.png"]).toBeUndefined();
  });
});

describe("acceptPendingAutoTag", () => {
  it("moves a pending tag into the confirmed path mapping", () => {
    const next = acceptPendingAutoTag(baseState, "/tmp/file-b.png", "tag-b");
    expect(next.pathToTagIds["/tmp/file-b.png"]).toEqual(["tag-b"]);
    expect(next.pendingAutoTags["/tmp/file-b.png"]).toBeUndefined();
  });
});

describe("removeTagEverywhere", () => {
  it("removes the tag from definitions, confirmed mappings, and pending suggestions", () => {
    const next = removeTagEverywhere(
      {
        ...baseState,
        pathToTagIds: {
          "/tmp/file-a.png": ["tag-a", "tag-b"],
        },
        pendingAutoTags: {
          "/tmp/file-b.png": ["tag-b"],
        },
      },
      "tag-b",
    );

    expect(next.tags.map((tag) => tag.id)).toEqual(["tag-a"]);
    expect(next.pathToTagIds["/tmp/file-a.png"]).toEqual(["tag-a"]);
    expect(next.pendingAutoTags["/tmp/file-b.png"]).toBeUndefined();
  });
});

describe("removePathEverywhere", () => {
  it("removes confirmed and pending mappings for the path", () => {
    const next = removePathEverywhere(
      {
        ...baseState,
        pathToTagIds: {
          "/tmp/file-a.png": ["tag-a"],
          "/tmp/file-b.png": ["tag-b"],
        },
        pendingAutoTags: {
          "/tmp/file-b.png": ["tag-b"],
          "/tmp/file-c.png": ["tag-a"],
        },
      },
      "/tmp/file-b.png",
    );

    expect(next.pathToTagIds["/tmp/file-a.png"]).toEqual(["tag-a"]);
    expect(next.pathToTagIds["/tmp/file-b.png"]).toBeUndefined();
    expect(next.pendingAutoTags["/tmp/file-b.png"]).toBeUndefined();
    expect(next.pendingAutoTags["/tmp/file-c.png"]).toEqual(["tag-a"]);
  });
});
