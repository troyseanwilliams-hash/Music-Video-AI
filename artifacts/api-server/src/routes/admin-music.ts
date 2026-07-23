// Admin-only AI song generation. Gated to ADMIN_EMAIL while the feature is
// being wired up — not exposed in the product yet. Generates a song, stores
// it in object storage, and returns a signed URL + the objectPath so it can
// be fed straight into the video generator (same shape as an upload).

import { Router, type IRouter, type Request, type Response } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { db, creditsTable, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { generateSong, getActiveMusicProvider, loopAudioToLength, MAX_SONG_SECONDS, type MusicProvider } from "../lib/musicApis.js";
import { generateLyrics, lyricsProviderAvailable } from "../lib/lyricsGen.js";
import { calculateSongCost, freeSoundtracksFor } from "../lib/creditCost.js";
import { notifyFeatureRequest } from "../lib/notifications.js";
import { getUncachableStripeClient } from "../lib/stripeClient.js";
import { ObjectStorageService } from "../lib/objectStorage.js";
import { logger } from "../lib/logger.js";

// Determine a user's subscription tier (starter/pro/studio) from Stripe.
async function getUserTier(user: { stripeSubscriptionId?: string | null }): Promise<string | null> {
  if (!user?.stripeSubscriptionId) return null;
  try {
    const stripe = await getUncachableStripeClient();
    const sub = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);
    const lk = sub.items.data[0]?.price?.lookup_key ?? null;
    if (!lk) return null;
    for (const t of ["studio", "pro", "starter"]) if (lk.startsWith(t)) return t;
    return null;
  } catch {
    return null;
  }
}

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
    // Which Pixazo models are wired. When freeMusicModel is unset, the free
    // tier has no $0 model to call and falls back to the paid one (which charges).
    paidMusicModel: process.env.PIXAZO_MUSIC_MODEL || "stable-audio-3-small-music-text-to-audio",
    freeMusicModel: process.env.PIXAZO_FREE_MUSIC_MODEL || null,
    hasFreeMusicModel: !!process.env.PIXAZO_FREE_MUSIC_MODEL,
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
  // Loop the generated clip (via ffmpeg, free) to this length to match a video.
  loopToSeconds: z.number().int().min(1).max(MAX_SONG_SECONDS).optional(),
  provider: z.enum(["simulation", "acestep", "musicgen", "pixazo"]).optional(),
  // Admin-only: force the free ($0) Pixazo model so the free tier can be tested
  // without funding the wallet. Ignored for non-admins (their routing is automatic).
  useFreeModel: z.boolean().optional(),
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

  // Freemium metering. Admins are unlimited. Subscribers get a monthly free
  // "Soundtracks" allowance by tier (a bonus that upsells higher plans); beyond
  // it, each track costs credits. Free tracks use the $0 Pixazo model.
  let isFree = admin; // no credit charge for this generation
  // Admins can opt into the free model (default on) to test the free tier
  // without funding the wallet; they can flip it off to test the paid model.
  let useFreeModel = admin ? parsed.data.useFreeModel !== false : false;
  let freeRemaining: number | null = null;

  if (!admin) {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.user.id)).limit(1);
    if ((user?.subscriptionStatus ?? "none") !== "active") {
      res.status(403).json({ error: "A subscription is required to generate Soundtracks.", code: "SUBSCRIPTION_REQUIRED" });
      return;
    }
    let [credits] = await db.select().from(creditsTable).where(eq(creditsTable.userId, req.user.id)).limit(1);
    if (!credits) {
      [credits] = await db.insert(creditsTable).values({ id: randomUUID(), userId: req.user.id }).returning();
    }

    // Lazy monthly reset of the free allowance.
    let used = credits?.freeSoundtracksUsed ?? 0;
    const resetAt = credits?.freeSoundtracksResetAt ? new Date(credits.freeSoundtracksResetAt).getTime() : 0;
    if (!resetAt || resetAt <= Date.now()) {
      used = 0;
      const next = new Date();
      next.setUTCMonth(next.getUTCMonth() + 1);
      await db.update(creditsTable).set({ freeSoundtracksUsed: 0, freeSoundtracksResetAt: next }).where(eq(creditsTable.userId, req.user.id));
    }

    const tier = await getUserTier(user);
    const allowance = freeSoundtracksFor(tier);

    if (used < allowance) {
      isFree = true;
      useFreeModel = true;
      freeRemaining = allowance - used - 1;
    } else if ((credits?.creditsRemaining ?? 0) < cost) {
      res.status(402).json({
        error: `You've used all ${allowance} free Soundtracks this month. Extra tracks cost ${cost} credits but you have ${credits?.creditsRemaining ?? 0}.`,
        code: "INSUFFICIENT_CREDITS",
        creditsRequired: cost,
        creditsRemaining: credits?.creditsRemaining ?? 0,
        freeAllowance: allowance,
      });
      return;
    } else {
      freeRemaining = 0;
    }
  }

  try {
    const song = await generateSong({
      prompt: parsed.data.prompt,
      lyrics: parsed.data.lyrics,
      durationSeconds: parsed.data.durationSeconds,
      provider: parsed.data.provider as MusicProvider | undefined,
      useFreeModel,
    });

    // Optionally loop the (short, cheap) clip to a longer length — free ffmpeg,
    // no extra provider cost, so you pay only for the short generation.
    let audioBuffer = song.audioBuffer;
    let ext = song.ext;
    let loopedToSeconds: number | null = null;
    if (parsed.data.loopToSeconds && parsed.data.loopToSeconds > parsed.data.durationSeconds) {
      const looped = await loopAudioToLength(song.audioBuffer, song.ext, parsed.data.loopToSeconds);
      audioBuffer = looped.buffer;
      ext = looped.ext;
      loopedToSeconds = parsed.data.loopToSeconds;
    }

    const songId = randomUUID();
    const objectPath = await storageService.uploadAudioBuffer(audioBuffer, songId, ext);
    const url = await storageService.getObjectEntitySignedUrl(objectPath, 3600);

    // On success (non-admins only): a free track burns one of the monthly
    // allowance; a paid track deducts credits (subscription bucket drawn first).
    if (!admin) {
      if (isFree) {
        await db
          .update(creditsTable)
          .set({ freeSoundtracksUsed: sql`free_soundtracks_used + 1` })
          .where(eq(creditsTable.userId, req.user.id));
      } else {
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
    }

    logger.info({ songId, provider: song.provider, cost, admin, isFree, loopedToSeconds }, "Soundtrack generated");
    res.json({
      songId,
      objectPath, // feed this straight into the video generator as the audio source
      url,
      provider: song.provider,
      hasVocals: song.hasVocals,
      ext,
      loopedToSeconds, // null unless the clip was looped
      creditsCharged: isFree ? 0 : cost,
      wasFree: isFree, // true when covered by the monthly free allowance
      freeRemaining, // free tracks left this month (null for admins)
    });
  } catch (err) {
    logger.error({ err }, "Admin song generation failed");
    res.status(500).json({
      error: err instanceof Error ? err.message : "Song generation failed",
    });
  }
});

// The signed-in user's Soundtracks freemium status: how many free tracks their
// tier includes, how many remain this month, and their credit balance for
// overage. Drives the "N free Soundtracks left" display.
router.get("/music/soundtracks-status", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const admin = isAdmin(req.user.email);
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.user.id)).limit(1);
  const [credits] = await db.select().from(creditsTable).where(eq(creditsTable.userId, req.user.id)).limit(1);

  const tier = await getUserTier(user ?? {});
  const freeAllowance = freeSoundtracksFor(tier);
  // Treat an elapsed reset window as a fresh month (matches generate-route reset).
  const resetAt = credits?.freeSoundtracksResetAt ? new Date(credits.freeSoundtracksResetAt).getTime() : 0;
  const used = !resetAt || resetAt <= Date.now() ? 0 : credits?.freeSoundtracksUsed ?? 0;

  res.json({
    admin, // admins generate unlimited/free
    tier,
    freeAllowance,
    freeUsed: used,
    freeRemaining: Math.max(0, freeAllowance - used),
    freeResetAt: credits?.freeSoundtracksResetAt ?? null,
    creditsRemaining: credits?.creditsRemaining ?? 0,
    subscriptionActive: (user?.subscriptionStatus ?? "none") === "active",
  });
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
