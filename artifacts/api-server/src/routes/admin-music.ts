// Admin-only AI song generation. Gated to ADMIN_EMAIL while the feature is
// being wired up — not exposed in the product yet. Generates a song, stores
// it in object storage, and returns a signed URL + the objectPath so it can
// be fed straight into the video generator (same shape as an upload).

import { Router, type IRouter, type Request, type Response } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { generateSong, getActiveMusicProvider, MAX_SONG_SECONDS, type MusicProvider } from "../lib/musicApis.js";
import { generateLyrics, lyricsProviderAvailable } from "../lib/lyricsGen.js";
import { ObjectStorageService } from "../lib/objectStorage.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();
const storageService = new ObjectStorageService();

function isAdmin(email: string | null | undefined): boolean {
  return !!(
    process.env.ADMIN_EMAIL &&
    email &&
    email.toLowerCase() === process.env.ADMIN_EMAIL.toLowerCase()
  );
}

// What's currently available (drives the admin UI: shows sim vs live).
router.get("/admin/music/status", (req: Request, res: Response) => {
  if (!req.isAuthenticated() || !isAdmin(req.user.email)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  res.json({
    activeProvider: getActiveMusicProvider(),
    hasReplicateKey: !!process.env.REPLICATE_API_TOKEN,
    // ACE-Step (vocals) needs an explicit model/version; MusicGen (instrumental)
    // is ready whenever the token is set (defaults to the meta/musicgen slug).
    aceStepReady: !!(process.env.MUSIC_ACESTEP_VERSION || process.env.MUSIC_ACESTEP_MODEL),
    musicGenReady: !!process.env.REPLICATE_API_TOKEN,
    lyricsProvider: lyricsProviderAvailable(),
  });
});

// Generate lyrics from a theme (AI when a key is set, template otherwise).
const LyricsBody = z.object({
  theme: z.string().min(2).max(300),
  genre: z.string().max(120).optional(),
  mood: z.string().max(120).optional(),
});

router.post("/admin/music/lyrics", async (req: Request, res: Response) => {
  if (!req.isAuthenticated() || !isAdmin(req.user.email)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const parsed = LyricsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  try {
    const { lyrics, source } = await generateLyrics(parsed.data);
    res.json({ lyrics, source });
  } catch (err) {
    logger.error({ err }, "Admin lyric generation failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Lyric generation failed" });
  }
});

const GenerateBody = z.object({
  prompt: z.string().min(3).max(600),
  lyrics: z.string().max(5000).optional(),
  durationSeconds: z.number().int().min(5).max(MAX_SONG_SECONDS).default(30),
  provider: z.enum(["simulation", "acestep", "musicgen"]).optional(),
});

router.post("/admin/music/generate", async (req: Request, res: Response) => {
  if (!req.isAuthenticated() || !isAdmin(req.user.email)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const parsed = GenerateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  try {
    const song = await generateSong({
      prompt: parsed.data.prompt,
      lyrics: parsed.data.lyrics,
      durationSeconds: parsed.data.durationSeconds,
      provider: parsed.data.provider as MusicProvider | undefined,
    });

    const songId = randomUUID();
    const objectPath = await storageService.uploadAudioBuffer(song.audioBuffer, songId, song.ext);
    const url = await storageService.getObjectEntitySignedUrl(objectPath, 3600);

    logger.info({ songId, provider: song.provider }, "Admin generated a song");
    res.json({
      songId,
      objectPath, // feed this straight into the video generator as the audio source
      url,
      provider: song.provider,
      hasVocals: song.hasVocals,
      ext: song.ext,
    });
  } catch (err) {
    logger.error({ err }, "Admin song generation failed");
    res.status(500).json({
      error: err instanceof Error ? err.message : "Song generation failed",
    });
  }
});

export default router;
