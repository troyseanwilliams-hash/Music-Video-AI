import { describe, expect, it } from "vitest";
import { classifySongSource } from "./teasers.js";

// Regression coverage for the "Guided Hybrid Lip Sync Remix" song-audio
// resolution decision (GET /videos/:id/song-audio): which of a job's audio
// fields to use, and the "unavailable" fallback when there's no audio at
// all. Pure/DB-free, so it's directly unit-testable; the route itself
// (ownership check, the actual object-storage fetch/upload for a
// youtube/suno-sourced song) needs a live DB + storage service and isn't
// covered here.

describe("classifySongSource", () => {
  it("prefers an already-uploaded audioObjectPath (cheap path, no download needed)", () => {
    expect(
      classifySongSource({ audioObjectPath: "/objects/song.mp3", audioSourceUrl: "https://example.com/song.mp3" }),
    ).toEqual({ kind: "stored", objectPath: "/objects/song.mp3" });
  });

  it("falls back to audioSourceUrl (youtube/suno import) when there's no stored object", () => {
    expect(classifySongSource({ audioObjectPath: null, audioSourceUrl: "https://youtube.example/watch?v=abc" })).toEqual({
      kind: "remote",
      url: "https://youtube.example/watch?v=abc",
    });
  });

  it("is \"unavailable\" when the job has neither field (e.g. a silent/no-audio video)", () => {
    expect(classifySongSource({ audioObjectPath: null, audioSourceUrl: null })).toEqual({ kind: "unavailable" });
    expect(classifySongSource(null)).toEqual({ kind: "unavailable" });
    expect(classifySongSource(undefined)).toEqual({ kind: "unavailable" });
  });

  it("treats an empty string the same as missing (not a usable path/url)", () => {
    expect(classifySongSource({ audioObjectPath: "", audioSourceUrl: "" })).toEqual({ kind: "unavailable" });
  });
});
