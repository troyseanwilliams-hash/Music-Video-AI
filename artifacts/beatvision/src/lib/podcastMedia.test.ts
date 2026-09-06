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
});