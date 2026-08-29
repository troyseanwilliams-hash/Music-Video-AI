import { describe, expect, it } from "vitest";
import {
  buildImagePackPlan,
  parsePublicImagePagination,
  toPublicImageAsset,
  toPersistedImagePackScenes,
  validateApprovedImageScenes,
} from "./image-assets.js";

describe("public generated-image DTO", () => {
  it("exposes stable safe detail and chronological scene position only", () => {
    const createdAt = new Date("2026-01-02T03:04:05.000Z");
    const source = {
      id: "asset-1",
      objectPath: "/objects/image-packs/job-1/4.png",
      assetIndex: 4,
      style: "cinematic",
      likeCount: 3,
      createdAt,
      creatorName: "Ada",
      prompt: "private generation prompt",
      userId: "private-owner",
      jobId: "private-job",
    };

    expect(toPublicImageAsset(source, true)).toEqual({
      id: "asset-1",
      objectPath: "/objects/image-packs/job-1/4.png",
      assetIndex: 4,
      style: "cinematic",
      likeCount: 3,
      liked: true,
      creatorName: "Ada",
      createdAt,
    });
    expect(toPublicImageAsset(source, true)).not.toHaveProperty("prompt");
    expect(toPublicImageAsset(source, true)).not.toHaveProperty("userId");
    expect(toPublicImageAsset(source, true)).not.toHaveProperty("jobId");
  });

  it("preserves anonymous attribution without inventing owner data", () => {
    const result = toPublicImageAsset({
      id: "asset-2",
      objectPath: "/objects/image-packs/job-2/0.png",
      assetIndex: 0,
      style: null,
      likeCount: 0,
      createdAt: new Date("2026-01-02T03:04:05.000Z"),
      creatorName: "Anonymous",
    }, false);

    expect(result.creatorName).toBe("Anonymous");
    expect(result.liked).toBe(false);
  });
});

describe("public generated-image pagination", () => {
  it("uses stable defaults and rejects invalid page requests", () => {
    expect(parsePublicImagePagination({})).toEqual({ page: 1, limit: 24 });
    expect(parsePublicImagePagination({ page: "2", limit: "12" })).toEqual({
      page: 2,
      limit: 12,
    });
    expect(parsePublicImagePagination({ page: "0", limit: "12" })).toBeNull();
    expect(parsePublicImagePagination({ page: "1", limit: "999" })).toBeNull();
    expect(parsePublicImagePagination({ page: "not-a-page" })).toBeNull();
    expect(parsePublicImagePagination({ page: "1.5", limit: "12" })).toBeNull();
    expect(parsePublicImagePagination({ page: "1", limit: "12.5" })).toBeNull();
    expect(parsePublicImagePagination({ page: ["1", "2"] })).toBeNull();
  });
});

describe("image-pack pre-charge storyboard approval", () => {
  it("plans numbered scenes without charging and preserves their normalized order", () => {
    const scenes = buildImagePackPlan({
      prompt: [
        "Shared rainy neo-noir visual direction.",
        "1. Detective enters the station.",
        "2. Detective finds the ticket.",
      ].join("\n"),
      imageCount: 2,
      style: "cinematic",
      hasCharacterReference: false,
    });

    expect(scenes).toHaveLength(2);
    expect(scenes.map((scene) => scene.index)).toEqual([0, 1]);
    expect(scenes[0]!.prompt).toContain("scene 1 of 2");
    expect(scenes[0]!.prompt).toContain("Detective enters the station");
    expect(scenes[1]!.prompt).toContain("scene 2 of 2");
    expect(scenes[1]!.prompt).toContain("Detective finds the ticket");
    // buildImagePackPlan is the no-I/O planning unit used by POST /image-packs/plan.
    // Credit reservation remains exclusively in the create route transaction.
  });

  it("keeps approved prompts unchanged when preparing the persisted scene list", () => {
    const approved = [
      { index: 0, prompt: "First approved prompt" },
      { index: 1, prompt: "Second approved prompt" },
    ];

    expect(validateApprovedImageScenes(approved, 2)).toEqual(approved);
  });

  it("persists supplied reference intent for every provider-consumable scene", () => {
    const persisted = toPersistedImagePackScenes([
      { index: 0, prompt: "First approved prompt" },
      { index: 1, prompt: "Second approved prompt" },
    ], "/objects/uploads/character.jpg");

    // Both job processors gate provider referenceImageUrl on this exact flag.
    expect(persisted).toEqual(expect.arrayContaining([
      expect.objectContaining({ index: 0, usesCharacterReference: true }),
      expect.objectContaining({ index: 1, usesCharacterReference: true }),
    ]));
    expect(toPersistedImagePackScenes(
      [{ index: 0, prompt: "No reference" }],
      null,
    )[0]).toMatchObject({ usesCharacterReference: false });
  });

  it("rejects incorrect scene counts, duplicate prompts, and non-chronological indices before reservation", () => {
    expect(() => validateApprovedImageScenes([{ index: 0, prompt: "Only one" }], 2))
      .toThrow("Approve exactly 2 scenes");
    expect(() => validateApprovedImageScenes([
      { index: 0, prompt: "Same scene" },
      { index: 1, prompt: " same   scene " },
    ], 2)).toThrow("unique");
    expect(() => validateApprovedImageScenes([
      { index: 1, prompt: "First" },
      { index: 0, prompt: "Second" },
    ], 2)).toThrow("chronological order");
  });
});