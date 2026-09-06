import { describe, expect, it } from "vitest";
import { extensionForUploadContentType } from "./uploadMime.js";

describe("extensionForUploadContentType", () => {
  it.each([
    ["audio/mp4", "m4a"],
    ["audio/x-m4a", "m4a"],
    ["application/ogg", "ogg"],
    ["audio/x-flac", "flac"],
    ["video/mp4", "mp4"],
  ])("maps %s to .%s", (mime, extension) => {
    expect(extensionForUploadContentType(mime)).toBe(extension);
  });

  it("maps every MIME accepted by Podcast Media", () => {
    expect([
      "audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/mp4", "audio/x-m4a",
      "audio/aac", "audio/ogg", "application/ogg", "audio/flac", "audio/x-flac", "video/mp4",
    ].map(extensionForUploadContentType)).toEqual([
      "mp3", "mp3", "wav", "wav", "m4a", "m4a",
      "aac", "ogg", "ogg", "flac", "flac", "mp4",
    ]);
  });
});