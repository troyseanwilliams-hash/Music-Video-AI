// Admin-only AI song generation. Gated to ADMIN_EMAIL while the feature is
// being wired up — not exposed in the product yet. Generates a song, stores
// it in object storage, and returns a signed URL + the objectPath so it can
// be fed straight into the video generator (same shape as an upload).

import { Router, type IRouter, type Request, type Response } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { db, creditsTable, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { generateSong, getActiveMusicProvider, MAX_SONG_SECONDS, type MusicProvider } from "../lib/musicApis.js";
import { generateLyrics, lyricsProviderAvailable } from "../lib/lyricsGen.js";
import { calculateSongCost } from "../lib/creditCost.js";
import { notifyFeatureRequest } from "../lib/notifications.js";
import { ObjectStorageService } from "../lib/objectStorage.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();
const storageService = new ObjectStorageService();

// Flip to "true" (env) to expose the audio generator to all active subscribers,
// metered on credits. While false it stays admin-only (admins never charged).
const SONG_GENERATOR_PUBLIC = process.env.SONG_GENERATOR_PUBLIC === "true";

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
    hasPixazoKey: !!process.env.PIXAZO_API_KEY,
    // ACE-Step (vocals) needs an explicit model/version; MusicGen (instrumental)
    // is ready whenever the Replicate token is set; Pixazo generates with its key.
    aceStepReady: !!(process.env.MUSIC_ACESTEP_VERSION || process.env.MUSIC_ACESTEP_MODEL),
    musicGenReady: !!process.env.REPLICATE_API_TOKEN,
    pixazoReady: !!process.env.PIXAZO_API_KEY,
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
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const admin = isAdmin(req.user.email);
  // Admins can always generate; regular users only when the feature is public.
  if (!admin && !SONG_GENERATOR_PUBLIC) {
    res.status(403).json({ error: "The audio generator isn't available yet." });
    return;
  }
  const parsed = GenerateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  const cost = calculateSongCost(parsed.data.durationSeconds);

  // Metered for non-admins (admins are unlimited): require active subscription
  // and sufficient credits; deducted on success only.
  if (!admin) {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.user.id)).limit(1);
    if ((user?.subscriptionStatus ?? "none") !== "active") {
      res.status(403).json({ error: "A subscription is required to generate audio.", code: "SUBSCRIPTION_REQUIRED" });
      return;
    }
    let [credits] = await db.select().from(creditsTable).where(eq(creditsTable.userId, req.user.id)).limit(1);
    if (!credits) {
      [credits] = await db.insert(creditsTable).values({ id: randomUUID(), userId: req.user.id }).returning();
    }
    if ((credits?.creditsRemaining ?? 0) < cost) {
      res.status(402).json({
        error: `This track costs ${cost} credits but you have ${credits?.creditsRemaining ?? 0}.`,
        code: "INSUFFICIENT_CREDITS",
        creditsRequired: cost,
        creditsRemaining: credits?.creditsRemaining ?? 0,
      });
      return;
    }
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

    // Deduct on success (non-admins only). Subscription bucket drawn first.
    if (!admin) {
      await db
        .update(creditsTable)
        .set({
          subscriptionCredits: sql`GREATEST(subscription_credits - ${cost}, 0)`,
          topupCredits: sql`GREATEST(topup_credits - GREATEST(${cost} - subscription_credits, 0), 0)`,
          creditsRemaining: sql`GREATEST(credits_remaining - ${cost}, 0)`,
          creditsUsed: sql`credits_used + ${cost}`,
        })
        .where(eq(creditsTable.userId, req.user.id));
    }

    logger.info({ songId, provider: song.provider, cost, admin }, "Song generated");
    res.json({
      songId,
      objectPath, // feed this straight into the video generator as the audio source
      url,
      provider: song.provider,
      hasVocals: song.hasVocals,
      ext: song.ext,
      creditsCharged: admin ? 0 : cost,
    });
  } catch (err) {
    logger.error({ err }, "Admin song generation failed");
    res.status(500).json({
      error: err instanceof Error ? err.message : "Song generation failed",
    });
  }
});

// Capture interest in vocals/lyrics (not live yet). Any signed-in user.
router.post("/music/request-vocals", (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  notifyFeatureRequest({ email: req.user.email, feature: "Vocals & lyrics for the song generator" });
  logger.info({ userId: req.user.id }, "Vocals feature requested");
  res.json({ success: true });
});

export default router;
