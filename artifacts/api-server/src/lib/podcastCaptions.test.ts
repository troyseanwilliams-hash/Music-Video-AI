import { describe, expect, it } from "vitest";
import { buildTimedSrt, ffprobeHasVideoStream, podcastRenderArgs, selectPodcastHighlights } from "./podcastCaptions.js";

describe("buildTimedSrt", () => {
  it("uses AssemblyAI word timestamps rather than distributing transcript text", () => {
    expect(buildTimedSrt([
      { text: "Hello", start: 1_250, end: 1_640 },
      { text: "world.", start: 1_700, end: 2_100 },
      { text: "Again", start: 12_000, end: 12_300 },
    ])).toBe(
      "1\n00:00:01,250 --> 00:00:02,100\nHello world.\n\n2\n00:00:12,000 --> 00:00:12,300\nAgain\n",
    );
  });

  it("drops invalid provider words and escapes subtitle markup", () => {
    expect(buildTimedSrt([
      { text: "<safe>", start: 0, end: 500 },
      { text: "bad", start: 900, end: 800 },
    ])).toContain("safe");
    expect(buildTimedSrt([{ text: "bad", start: 900, end: 800 }])).toBe("");
  });

  it("uses caption burn-in for both preserved MP4 and waveform audio branches", () => {
    const video = podcastRenderArgs("input.mp4", "captions.srt", "full.mp4", true);
    const audio = podcastRenderArgs("input.mp3", "captions.srt", "full.mp4", false);
    expect(video.join(" ")).toContain("subtitles=captions.srt");
    expect(video.join(" ")).toContain("scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080");
    expect(video).toContain("0:v:0");
    expect(audio).toContain("[0:a]showwaves=s=1920x1080:mode=line:colors=0x7dd3fc,format=yuv420p,subtitles=captions.srt[v]");
    expect(audio).toContain("[v]");
  });

  it.each([
    ["audio/mp4", [{ codec_type: "audio" }], false],
    ["audio/x-m4a", [{ codec_type: "audio" }], false],
    ["application/ogg", [{ codec_type: "audio" }], false],
    ["audio/x-flac", [{ codec_type: "audio" }], false],
    ["video/mp4", [{ codec_type: "video" }, { codec_type: "audio" }], true],
  ])("classifies a %s upload from its actual ffprobe streams", (_mime, streams, expected) => {
    expect(ffprobeHasVideoStream(JSON.stringify({ streams }))).toBe(expected);
  });

  it("rejects malformed ffprobe stream metadata", () => {
    expect(() => ffprobeHasVideoStream("{}")).toThrow(/invalid stream metadata/i);
  });

  it("selects distinct transcript-led non-overlapping highlights", () => {
    const words = [5, 40, 75].flatMap((second) => [
      { text: "Specific", start: second * 1000, end: second * 1000 + 300 },
      { text: `insight${second}.`, start: second * 1000 + 350, end: second * 1000 + 700 },
    ]);
    const highlights = selectPodcastHighlights(words, 110);
    expect(highlights).toHaveLength(3);
    expect(highlights.map(item => item.title)).not.toEqual(["Highlight 1", "Highlight 2", "Highlight 3"]);
    expect(highlights[1]!.startTime).toBeGreaterThanOrEqual(highlights[0]!.startTime + 30);
  });

  it("rejects episodes too short to create meaningful distinct clips", () => {
    expect(() => selectPodcastHighlights([], 89)).toThrow(/at least 90 seconds/i);
  });
});