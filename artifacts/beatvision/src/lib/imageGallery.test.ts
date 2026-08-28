import { describe, expect, it } from "vitest";
import { orderGalleryImages } from "./imageGallery";

describe("orderGalleryImages", () => {
  it("keeps the newest packs first and scenes chronological within each pack", () => {
    const ordered = orderGalleryImages([
      { id: "older-2", jobId: "older", assetIndex: 1, createdAt: "2026-01-01T00:00:02Z" },
      { id: "newer-2", jobId: "newer", assetIndex: 1, createdAt: "2026-01-02T00:00:02Z" },
      { id: "older-1", jobId: "older", assetIndex: 0, createdAt: "2026-01-01T00:00:01Z" },
      { id: "newer-1", jobId: "newer", assetIndex: 0, createdAt: "2026-01-02T00:00:01Z" },
    ]);

    expect(ordered.map((asset) => asset.id)).toEqual([
      "newer-1",
      "newer-2",
      "older-1",
      "older-2",
    ]);
  });
});