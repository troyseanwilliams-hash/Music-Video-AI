// Admin-only AI song generation. Gated to ADMIN_EMAIL while the feature is
// being wired up — not exposed in the product yet. Generates a song, stores
// it in object storage, and returns a signed URL + the objectPath so it can
// be fed straight into the video generator (same shape as an upload).

import { Router, type IRouter, type Request, type Response } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { generateSong, getActiveMusicProvider, type MusicProvider } from "../lib/musicApis.js";
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
    aceStepReady: !!process.env.MUSIC_ACESTEP_VERSION,
    musicGenReady: !!process.env.MUSIC_MUSICGEN_VERSION,
  });
});

const GenerateBody = z.object({
  prompt: z.string().min(3).max(600),
  lyrics: z.string().max(5000).optional(),
  durationSeconds: z.number().int().min(5).max(240).default(30),
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
