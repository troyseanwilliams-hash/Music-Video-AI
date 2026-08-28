import { describe, expect, it } from "vitest";
import { CreateJobBody } from "@workspace/api-zod";
import { buildTimedLines } from "./lyricTiming.js";
import { MAX_LYRICS_LENGTH } from "./lyricLimits.js";

const baseJob = {
  prompt: "A cinematic performance",
  style: "cinematic" as const,
  audioSourceType: "upload" as const,
  scriptApproved: true,
};

describe("long timed lyrics", () => {
  it("accepts Auto-sync output beyond the previous 5,000-character cap", () => {
    const lyricsText = `[00:00.00]${"sing ".repeat(1_200)}`;
    expect(lyricsText.length).toBeGreaterThan(5_000);
    expect(
      CreateJobBody.safeParse({ ...baseJob, lyricsText }).success,
    ).toBe(true);
  });

  it("still rejects unexpectedly large lyric payloads", () => {
    const lyricsText = "x".repeat(MAX_LYRICS_LENGTH + 1);
    expect(
      CreateJobBody.safeParse({ ...baseJob, lyricsText }).success,
    ).toBe(false);
  });

  it("keeps more than 80 timed lines for long-track videos", () => {
    const lyricsText = Array.from({ length: 120 }, (_, index) => {
      const minute = Math.floor(index / 60);
      const second = index % 60;
      return `[${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}]Line ${index + 1}`;
    }).join("\n");

    expect(buildTimedLines(lyricsText, 180)).toHaveLength(120);
  });
});