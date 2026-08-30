import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildElevenMusicRequest,
  buildPixazoMusicRequest,
  generateSong,
  getActiveMusicProvider,
  inferVocalDurationSeconds,
  isElevenMusicCredentialFailure,
  isUsableElevenLabsMusicCredential,
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

describe("vocal provider credential routing", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("recognizes full ElevenLabs keys but rejects key IDs", () => {
    expect(isUsableElevenLabsMusicCredential("sk_abcdefghijklmnopqrstuvwxyz")).toBe(true);
    expect(isUsableElevenLabsMusicCredential("1234567890abcdef")).toBe(false);
  });

  it("uses the fallback for vocal songs when the direct secret is a key ID", () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "1234567890abcdef");
    vi.stubEnv("PIXAZO_API_KEY", "configured-fallback");
    expect(getActiveMusicProvider(null, true)).toBe("pixazo");
  });

  it("selects Eleven Music for vocal songs with a full key", () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "sk_abcdefghijklmnopqrstuvwxyz");
    vi.stubEnv("PIXAZO_API_KEY", "configured-fallback");
    expect(getActiveMusicProvider(null, true)).toBe("elevenlabs");
  });

  it("keeps an explicit Eleven Music request pinned for clear diagnostics", () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "1234567890abcdef");
    vi.stubEnv("PIXAZO_API_KEY", "configured-fallback");
    expect(getActiveMusicProvider("elevenlabs", true)).toBe("elevenlabs");
  });

  it("keeps an explicit Eleven Music request pinned when its secret is missing", () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "");
    vi.stubEnv("PIXAZO_API_KEY", "configured-fallback");
    expect(getActiveMusicProvider("elevenlabs", true)).toBe("elevenlabs");
  });

  it("only classifies definitive pre-generation credential failures for fallback", () => {
    expect(isElevenMusicCredentialFailure(401)).toBe(true);
    expect(isElevenMusicCredentialFailure(403)).toBe(true);
    expect(isElevenMusicCredentialFailure(400, "api_key_id_used_as_api_key")).toBe(true);
    expect(isElevenMusicCredentialFailure(400, "missing_permissions")).toBe(true);
    expect(isElevenMusicCredentialFailure(422)).toBe(false);
    expect(isElevenMusicCredentialFailure(500)).toBe(false);
  });

  it("returns a provider-neutral error for an explicitly pinned key ID", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "1234567890abcdef");

    const generation = generateSong({
      prompt: "Original soul song",
      lyrics: "[Verse]\nAn original line",
      withVocals: true,
      provider: "elevenlabs",
    });

    await expect(generation).rejects.toThrow(
      "AI vocal generation is temporarily unavailable. No credits were charged",
    );
    await expect(generation).rejects.not.toThrow(/Eleven|API_KEY|key ID|paid/i);
  });

  it("returns a provider-neutral error for an explicitly pinned missing secret", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "");

    const generation = generateSong({
      prompt: "Original soul song",
      lyrics: "[Verse]\nAn original line",
      withVocals: true,
      provider: "elevenlabs",
    });

    await expect(generation).rejects.toThrow(
      "AI vocal generation is temporarily unavailable. No credits were charged",
    );
    await expect(generation).rejects.not.toThrow(
      /Eleven|API_KEY|secret|configured|paid/i,
    );
  });

  it.each([401, 403])(
    "returns a provider-neutral error for a pinned HTTP %s credential rejection",
    async (status) => {
      vi.stubEnv("ELEVENLABS_API_KEY", "sk_abcdefghijklmnopqrstuvwxyz");
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              detail: {
                status: "missing_permissions",
                message: "restricted credential",
              },
            }),
            { status, headers: { "Content-Type": "application/json" } },
          ),
        ),
      );

      const generation = generateSong({
        prompt: "Original soul song",
        lyrics: "[Verse]\nAn original line",
        withVocals: true,
        provider: "elevenlabs",
      });

      await expect(generation).rejects.toThrow(
        "AI vocal generation is temporarily unavailable. No credits were charged",
      );
      await expect(generation).rejects.not.toThrow(/Eleven|API_KEY|permission|paid/i);
    },
  );
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