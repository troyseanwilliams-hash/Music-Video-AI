import { describe, expect, it } from "vitest";
import { formatMediaDuration, normalizePodcastHighlights, podcastMediaUrl } from "./podcastMedia";

describe("podcast media helpers", () => {
  it("formats media durations and never returns negative time", () => {
    expect(formatMediaDuration(65)).toBe("1:05");
    expect(formatMediaDuration(-3)).toBe("0:00");
  });

  it("uses the authenticated storage proxy for object paths", () => {
    expect(podcastMediaUrl("/objects/user/episode.mp4")).toBe("/api/storage/objects/user/episode.mp4");
    expect(podcastMediaUrl("/api/storage/objects/user/episode.mp4")).toBe("/api/storage/objects/user/episode.mp4");
  });

  it("normalizes concise highlight response variants", () => {
    expect(normalizePodcastHighlights([{ title: "Big idea", summary: "A practical takeaway", clipPath: "/objects/a.mp4" }]))
      .toEqual([{ id: "0", title: "Big idea", description: "A practical takeaway", startSeconds: undefined, endSeconds: undefined, path: "/objects/a.mp4" }]);
  });

  it("normalizes backend start time and duration while preserving legacy times", () => {
    expect(normalizePodcastHighlights([
      { startTime: 12, durationSeconds: 30 },
      { startSeconds: 8, endSeconds: 19, startTime: 99, durationSeconds: 99 },
    ])).toEqual([
      expect.objectContaining({ startSeconds: 12, endSeconds: 42 }),
      expect.objectContaining({ startSeconds: 8, endSeconds: 19 }),
    ]);
  });
});