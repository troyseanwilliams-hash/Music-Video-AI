import { describe, expect, it } from "vitest";
import { editorMusicTempPaths } from "./editorStitcher.js";

describe("editor music temporary paths", () => {
  it("keeps an MP4 music input distinct from the MP4 render output", () => {
    const paths = editorMusicTempPaths("/tmp/editor-job", "mp4");

    expect(paths.inputPath).toBe("/tmp/editor-job/music-input.mp4");
    expect(paths.outputPath).toBe("/tmp/editor-job/with-music.mp4");
    expect(paths.inputPath).not.toBe(paths.outputPath);
  });

  it("normalizes valid extensions and rejects path-like extensions", () => {
    expect(editorMusicTempPaths("/tmp/editor-job", "M4A").inputPath).toBe(
      "/tmp/editor-job/music-input.m4a",
    );
    expect(
      editorMusicTempPaths("/tmp/editor-job", "../../music.mp4").inputPath,
    ).toBe("/tmp/editor-job/music-input.mp3");
  });
});