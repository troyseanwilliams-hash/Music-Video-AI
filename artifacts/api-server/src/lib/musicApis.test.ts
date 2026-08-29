import { describe, expect, it } from "vitest";
import { inferVocalDurationSeconds } from "./musicApis.js";
import { preserveDraftIfRewritten } from "./lyricsGen.js";

describe("inferVocalDurationSeconds", () => {
  it("uses a full-song default when the provider writes the lyrics", () => {
    expect(inferVocalDurationSeconds()).toBe(180);
  });

  it("derives longer targets from longer structured lyrics", () => {
    const shortLyrics = `[Verse]\n${"word ".repeat(50)}`;
    const longLyrics = `[Verse]\n${"word ".repeat(120)}\n[Chorus]\n${"word ".repeat(80)}`;

    expect(inferVocalDurationSeconds(longLyrics)).toBeGreaterThan(
      inferVocalDurationSeconds(shortLyrics),
    );
  });

  it("keeps inferred vocal songs within supported bounds", () => {
    expect(inferVocalDurationSeconds("one short line")).toBe(60);
    expect(inferVocalDurationSeconds("word ".repeat(1_000))).toBe(300);
  });
});

describe("preserveDraftIfRewritten", () => {
  const draft = `[Verse]
Streetlights blur outside the glass
I keep your picture by the door

[Chorus]
Come back home, come back home`;

  it("keeps a draft when an enhancement changes the song structure", () => {
    const rewritten = `[Verse]
The city glows beneath the rain

[Bridge]
I found a brand-new way to heal

[Chorus]
I am free, I am free`;

    expect(preserveDraftIfRewritten(draft, rewritten)).toBe(draft);
  });

  it("allows a close, light-touch edit", () => {
    const lightlyEdited = `[Verse]
Streetlights blur outside the glass
I keep your picture near the door

[Chorus]
Come back home, come back home`;

    expect(preserveDraftIfRewritten(draft, lightlyEdited)).toBe(lightlyEdited);
  });

  it("falls back to the original draft when the candidate is empty", () => {
    expect(preserveDraftIfRewritten(draft, "")).toBe(draft);
  });
});