import { afterEach, describe, expect, it, vi } from "vitest";
import {
  newIdempotencyKey,
  photoAnimationRequestFingerprint,
  matchesPhotoAnimationOperation,
  isUnambiguousPhotoAnimationRejection,
  readPhotoAnimationOperationIntent,
  writePhotoAnimationOperationIntent,
  photoAnimationSourceKey,
  samePhotoAnimationInput,
  storyHandoffUrl,
  type PhotoAnimationInput,
} from "./photoAnimation";

const input: PhotoAnimationInput = {
  source: { kind: "asset", imageAssetId: "image-1" },
  prompt: "A gentle camera push in",
  durationSeconds: 5,
  provider: "kling",
  resolution: "720p",
  aspectRatio: "9:16",
};

describe("photo animation helpers", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("builds an owned-image story handoff without duplicating scene images", () => {
    const url = storyHandoffUrl("/objects/users/me/image.png", "A small safe adventure");
    const params = new URL(url, "https://example.test").searchParams;
    expect(params.get("referenceImagePath")).toBe("/objects/users/me/image.png");
    expect(params.get("prompt")).toBe("A small safe adventure");
    expect(params.has("sceneImages")).toBe(false);
  });

  it("invalidates confirmation when any input changes", () => {
    expect(samePhotoAnimationInput(input, { ...input })).toBe(true);
    expect(samePhotoAnimationInput(input, { ...input, durationSeconds: 10 })).toBe(false);
    expect(samePhotoAnimationInput(input, { ...input, prompt: "Pan left" })).toBe(false);
  });

  it("uses stable source identities and unique intent keys", () => {
    expect(photoAnimationSourceKey(input.source)).toBe("asset:image-1");
    expect(newIdempotencyKey()).not.toBe(newIdempotencyKey());
  });

  it("fingerprints the canonical request without retaining its prompt", async () => {
    const first = await photoAnimationRequestFingerprint(input);
    const same = await photoAnimationRequestFingerprint({ ...input });
    const changed = await photoAnimationRequestFingerprint({ ...input, prompt: "Different motion" });
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).toBe(same);
    expect(first).not.toBe(changed);
    expect(first).not.toContain(input.prompt);
    expect(matchesPhotoAnimationOperation({
      idempotencyKey: "operation-key",
      requestFingerprint: first,
      sourceKey: "asset:image-1",
      createdAt: 1,
    }, same)).toBe(true);
    expect(matchesPhotoAnimationOperation({
      idempotencyKey: "operation-key",
      requestFingerprint: first,
      sourceKey: "asset:image-1",
      createdAt: 1,
    }, changed)).toBe(false);
  });

  it("persists only the operation fingerprint and preserves it across lookup absence", () => {
    const entries = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => entries.set(key, value),
      removeItem: (key: string) => entries.delete(key),
    });
    writePhotoAnimationOperationIntent("user-1", input.source, {
      idempotencyKey: "operation-1",
      requestFingerprint: "a".repeat(64),
    });
    const raw = [...entries.values()][0]!;
    expect(raw).not.toContain(input.prompt);
    expect(readPhotoAnimationOperationIntent("user-1", input.source)?.idempotencyKey).toBe("operation-1");
    // OPERATION_NOT_FOUND is a lookup result, not a definitive POST rejection.
    expect(isUnambiguousPhotoAnimationRejection(404)).toBe(false);
    expect(readPhotoAnimationOperationIntent("user-1", input.source)?.requestFingerprint).toBe("a".repeat(64));
  });

  it("clears an intent only for definitive client-side submit rejection statuses", () => {
    expect(isUnambiguousPhotoAnimationRejection(400)).toBe(true);
    expect(isUnambiguousPhotoAnimationRejection(409, "STALE_PLAN")).toBe(true);
    expect(isUnambiguousPhotoAnimationRejection(409, "IDEMPOTENCY_MISMATCH")).toBe(false);
    expect(isUnambiguousPhotoAnimationRejection(422)).toBe(true);
    expect(isUnambiguousPhotoAnimationRejection(404)).toBe(false);
    expect(isUnambiguousPhotoAnimationRejection(500)).toBe(false);
  });
});