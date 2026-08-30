import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildElevenMusicRequest,
  buildPixazoMusicRequest,
  inferVocalDurationSeconds,
} from "./musicApis.js";
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

describe("buildPixazoMusicRequest", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the current MiniMax Music 3.0 contract for vocal songs", () => {
    expect(
      buildPixazoMusicRequest({
        prompt: "Soulful R&B with warm piano",
        lyrics: "[verse]\nMeet me by the window",
        withVocals: true,
      }),
    ).toEqual({
      model: "minimax-music-3-0",
      op: "text-to-music",
      body: {
        prompt: "Soulful R&B with warm piano",
        lyrics: "[verse]\nMeet me by the window",
        format: "mp3",
        sample_rate: 44100,
        bitrate: 256000,
      },
    });
  });

  it("preserves provider-written lyrics on the Music 3.0 contract", () => {
    expect(
      buildPixazoMusicRequest({
        prompt: "Write and sing an uplifting soul song",
        withVocals: true,
        lyricsOptimizer: true,
      }).body,
    ).toMatchObject({
      lyrics_optimizer: true,
      format: "mp3",
      sample_rate: 44100,
      bitrate: 256000,
    });
  });

  it("keeps an explicitly configured legacy model on its legacy operation", () => {
    vi.stubEnv("PIXAZO_SONG_MODEL", "minimax-music-generation-2-6");

    expect(
      buildPixazoMusicRequest({
        prompt: "Soul song",
        lyrics: "[verse]\nA legacy request",
        withVocals: true,
      }),
    ).toMatchObject({
      model: "minimax-music-generation-2-6",
      op: "generate",
      body: {
        is_instrumental: false,
      },
    });
  });
});

describe("buildElevenMusicRequest", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the Music v2 contract and embeds original lyrics in the prompt", () => {
    vi.stubEnv("ELEVENLABS_MUSIC_MODEL", "music_v2");

    expect(
      buildElevenMusicRequest({
        prompt: "Warm cinematic soul with piano and brushed drums",
        lyrics: "[Verse]\nMeet me by the window",
        durationSeconds: 95,
        withVocals: true,
      }),
    ).toEqual({
      prompt:
        "Warm cinematic soul with piano and brushed drums\n\n" +
        "Create a complete vocal song using these exact original lyrics. Preserve the section order and words while composing a natural, singable melody:\n\n" +
        "[Verse]\nMeet me by the window",
      musicLengthMs: 95000,
      modelId: "music_v2",
    });
  });

  it("asks Eleven Music to write original lyrics when the optimizer is enabled", () => {
    expect(
      buildElevenMusicRequest({
        prompt: "An uplifting indie-pop road song",
        withVocals: true,
        lyricsOptimizer: true,
      }).prompt,
    ).toContain("original lyrics that fit the style and subject above");
  });

  it("rejects prompts that exceed Eleven Music's documented limit", () => {
    expect(() =>
      buildElevenMusicRequest({
        prompt: "x".repeat(4100),
        withVocals: true,
      }),
    ).toThrow("too long");
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