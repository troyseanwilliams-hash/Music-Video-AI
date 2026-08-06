// Admin-only AI song generation. Gated to ADMIN_EMAIL while the feature is
// being wired up — not exposed in the product yet. Generates a song, stores
// it in object storage, and returns a signed URL + the objectPath so it can
// be fed straight into the video generator (same shape as an upload).

import { Router, type IRouter, type Request, type Response } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { db, creditsTable, usersTable, soundtracksTable, soundtrackLikesTable } from "@workspace/db";
import { eq, sql, and, desc, isNull, inArray } from "drizzle-orm";
import { generateSong, getActiveMusicProvider, loopAudioToLength, MAX_SONG_SECONDS, type MusicProvider } from "../lib/musicApis.js";
import { generateLyrics, lyricsProviderAvailable } from "../lib/lyricsGen.js";
import { calculateSongCost, freeSoundtracksFor, NEW_USER_FREE_SOUNDTRACKS, SONG_VOCAL_CREDITS } from "../lib/creditCost.js";
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

// Soundtracks is live for active subscribers (metered per the freemium model).
// Set SONG_GENERATOR_PUBLIC="false" as a kill switch to make it admin-only again.
const SONG_GENERATOR_PUBLIC = process.env.SONG_GENERATOR_PUBLIC !== "false";

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
    // The single Pixazo music model used for every Soundtrack.
    musicModel: process.env.PIXAZO_MUSIC_MODEL || "stable-audio-3-small-music-text-to-audio",
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
  // Vocal (MiniMax) songs can run longer than the instrumental cap; instrumental
  // is still clamped to MAX_SONG_SECONDS internally by the generator + looper.
  durationSeconds: z.number().int().min(5).max(240).default(30),
  // Loop the generated clip (via ffmpeg, free) to this length to match a video.
  loopToSeconds: z.number().int().min(1).max(MAX_SONG_SECONDS).optional(),
  provider: z.enum(["simulation", "acestep", "musicgen", "pixazo"]).optional(),
  // Generate a full VOCAL song (MiniMax) instead of an instrumental. Priced
  // higher and never covered by the free allowance.
  withVocals: z.boolean().optional(),
  // Let the model write the lyrics from the prompt (no lyrics box needed).
  lyricsOptimizer: z.boolean().optional(),
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

  const wantsVocals = parsed.data.withVocals === true;
  const cost = calculateSongCost(parsed.data.durationSeconds, wantsVocals);

  // Freemium metering. Admins are unlimited. Subscribers get a monthly free
  // "Soundtracks" allowance by tier (a bonus that upsells higher plans); beyond
  // it, each track costs credits. Free tracks use the $0 Pixazo model.
  let isFree = admin; // no credit charge for this generation (admins never charged)
  let freeRemaining: number | null = null;

  if (!admin) {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.user.id)).limit(1);
    let [credits] = await db.select().from(creditsTable).where(eq(creditsTable.userId, req.user.id)).limit(1);
    if (!credits) {
      [credits] = await db.insert(creditsTable).values({ id: randomUUID(), userId: req.user.id }).returning();
    }
    const active = (user?.subscriptionStatus ?? "none") === "active";

    if (wantsVocals) {
      // Vocal songs run on the pricier MiniMax model — always credit-charged,
      // never part of the free monthly Soundtracks allowance.
      if ((credits?.creditsRemaining ?? 0) < cost) {
        res.status(402).json({
          error: `A vocal song costs ${cost} credits but you have ${credits?.creditsRemaining ?? 0}.`,
          code: "INSUFFICIENT_CREDITS",
          creditsRequired: cost,
          creditsRemaining: credits?.creditsRemaining ?? 0,
        });
        return;
      }
      // isFree stays false → credits are deducted on success below.
    } else if (active) {
      // Subscriber: monthly free allowance by tier (lazy monthly reset).
      let used = credits?.freeSoundtracksUsed ?? 0;
      const resetAt = credits?.freeSoundtracksResetAt ? new Date(credits.freeSoundtracksResetAt).getTime() : 0;
      if (!resetAt || resetAt <= Date.now()) {
        used = 0;
        const next = new Date();
        next.setUTCMonth(next.getUTCMonth() + 1);
        await db.update(creditsTable).set({ freeSoundtracksUsed: 0, freeSoundtracksResetAt: next }).where(eq(creditsTable.userId, req.user.id));
      }

      const tier = await getUserTier(user);
      // Active subscribers always get their free allowance; if the Stripe tier
      // can't be read, fall back to the Starter allowance so free tracks are
      // never accidentally charged to their credit balance.
      const allowance = freeSoundtracksFor(tier) || freeSoundtracksFor("starter");

      if (used < allowance) {
        isFree = true;
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
    } else {
      // New / non-subscriber: a one-time signup bonus of free Soundtracks to try
      // the feature (lifetime — no monthly reset; the same counter carries over
      // and is reset to 0 the first time they subscribe). Then upsell.
      const used = credits?.freeSoundtracksUsed ?? 0;
      if (used < NEW_USER_FREE_SOUNDTRACKS) {
        isFree = true;
        freeRemaining = NEW_USER_FREE_SOUNDTRACKS - used - 1;
      } else {
        res.status(403).json({
          error: `You've used your ${NEW_USER_FREE_SOUNDTRACKS} free Soundtracks. Subscribe to get more every month.`,
          code: "SUBSCRIPTION_REQUIRED",
        });
        return;
      }
    }
  }

  try {
    const song = await generateSong({
      prompt: parsed.data.prompt,
      lyrics: parsed.data.lyrics,
      durationSeconds: parsed.data.durationSeconds,
      provider: parsed.data.provider as MusicProvider | undefined,
      withVocals: wantsVocals,
      lyricsOptimizer: parsed.data.lyricsOptimizer,
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

    // Persist to the user's Soundtracks library (play/download/reuse/share).
    // Non-fatal: if this fails (e.g. the table isn't migrated yet), the user
    // still gets their generated track back rather than losing the generation.
    const title = parsed.data.prompt.trim().split(/\s+/).slice(0, 5).join(" ") || "AI Soundtrack";
    let savedToLibrary = true;
    try {
      await db.insert(soundtracksTable).values({
        id: songId,
        userId: req.user.id,
        title,
        prompt: parsed.data.prompt,
        lyrics: wantsVocals ? parsed.data.lyrics ?? null : null,
        hasVocals: song.hasVocals,
        objectPath,
        ext,
        durationSeconds: parsed.data.durationSeconds,
        loopedToSeconds,
        provider: song.provider,
      });
    } catch (persistErr) {
      savedToLibrary = false;
      logger.error({ err: persistErr, songId }, "Soundtrack generated but failed to save to library (is the soundtracks table migrated?)");
    }

    logger.info({ songId, provider: song.provider, cost, admin, isFree, loopedToSeconds, savedToLibrary }, "Soundtrack generated");
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
      savedToLibrary, // false if the library insert failed (track still returned)
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
  const active = (user?.subscriptionStatus ?? "none") === "active";

  let freeAllowance: number;
  let used: number;
  let tier: string | null = null;
  if (active) {
    // Subscriber: monthly allowance by tier. Elapsed reset window = fresh month.
    tier = await getUserTier(user ?? {});
    freeAllowance = freeSoundtracksFor(tier) || freeSoundtracksFor("starter");
    const resetAt = credits?.freeSoundtracksResetAt ? new Date(credits.freeSoundtracksResetAt).getTime() : 0;
    used = !resetAt || resetAt <= Date.now() ? 0 : credits?.freeSoundtracksUsed ?? 0;
  } else {
    // New / non-subscriber: one-time signup bonus (lifetime counter, no reset).
    freeAllowance = NEW_USER_FREE_SOUNDTRACKS;
    used = credits?.freeSoundtracksUsed ?? 0;
  }

  res.json({
    admin, // admins generate unlimited/free
    enabled: SONG_GENERATOR_PUBLIC || admin, // whether this user can generate now
    tier,
    isSignupBonus: !active, // freeAllowance is the one-time new-user bonus
    freeAllowance,
    freeUsed: used,
    freeRemaining: Math.max(0, freeAllowance - used),
    freeResetAt: active ? credits?.freeSoundtracksResetAt ?? null : null,
    creditsRemaining: credits?.creditsRemaining ?? 0,
    subscriptionActive: active,
    // Vocal (with-lyrics) song generation: flat credit cost + whether the
    // vocal model (MiniMax via Pixazo) is configured.
    vocalCost: SONG_VOCAL_CREDITS,
    vocalsEnabled: !!process.env.PIXAZO_API_KEY,
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

// ── Soundtracks library (per-user) ──────────────────────────────────────────

// List the signed-in user's Soundtracks (newest first), each with a fresh
// signed audio URL for inline playback/download.
router.get("/music/soundtracks", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const rows = await db
    .select()
    .from(soundtracksTable)
    .where(and(eq(soundtracksTable.userId, req.user.id), isNull(soundtracksTable.deletedAt)))
    .orderBy(desc(soundtracksTable.createdAt))
    .limit(200);

  const items = await Promise.all(
    rows.map(async (s) => ({
      id: s.id,
      title: s.title,
      prompt: s.prompt,
      objectPath: s.objectPath,
      ext: s.ext,
      durationSeconds: s.durationSeconds,
      loopedToSeconds: s.loopedToSeconds,
      provider: s.provider,
      isPublic: s.isPublic,
      shareToken: s.shareToken,
      createdAt: s.createdAt,
      url: await storageService.getObjectEntitySignedUrl(s.objectPath, 3600),
    })),
  );
  res.json({ soundtracks: items });
});

// Soft-delete one of the user's Soundtracks.
router.delete("/music/soundtracks/:id", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const [row] = await db
    .select()
    .from(soundtracksTable)
    .where(and(eq(soundtracksTable.id, String(req.params.id)), eq(soundtracksTable.userId, req.user.id)))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  await db.update(soundtracksTable).set({ deletedAt: new Date() }).where(eq(soundtracksTable.id, row.id));
  res.json({ success: true });
});

// Rename one of the user's Soundtracks.
router.post("/music/soundtracks/:id/rename", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const title = String(req.body?.title ?? "").trim().slice(0, 120);
  if (!title) {
    res.status(400).json({ error: "Title is required" });
    return;
  }
  const [row] = await db
    .select()
    .from(soundtracksTable)
    .where(and(eq(soundtracksTable.id, String(req.params.id)), eq(soundtracksTable.userId, req.user.id)))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  await db.update(soundtracksTable).set({ title }).where(eq(soundtracksTable.id, row.id));
  res.json({ id: row.id, title });
});

// Public gallery feed for Explore: all public, non-deleted Soundtracks.
router.get("/music/public", async (req: Request, res: Response) => {
  const rows = await db
    .select({
      id: soundtracksTable.id,
      title: soundtracksTable.title,
      prompt: soundtracksTable.prompt,
      objectPath: soundtracksTable.objectPath,
      shareToken: soundtracksTable.shareToken,
      createdAt: soundtracksTable.createdAt,
      likeCount: soundtracksTable.likeCount,
      creatorName: usersTable.firstName,
    })
    .from(soundtracksTable)
    .leftJoin(usersTable, eq(soundtracksTable.userId, usersTable.id))
    .where(and(eq(soundtracksTable.isPublic, true), isNull(soundtracksTable.deletedAt)))
    .orderBy(desc(soundtracksTable.likeCount), desc(soundtracksTable.createdAt))
    .limit(60);

  // Which of these the current user has liked (empty for anonymous viewers).
  const ids = rows.map((r) => r.id);
  let likedSet = new Set<string>();
  if (req.isAuthenticated() && ids.length) {
    const liked = await db
      .select({ soundtrackId: soundtrackLikesTable.soundtrackId })
      .from(soundtrackLikesTable)
      .where(and(eq(soundtrackLikesTable.userId, req.user.id), inArray(soundtrackLikesTable.soundtrackId, ids)));
    likedSet = new Set(liked.map((l) => l.soundtrackId));
  }

  const soundtracks = await Promise.all(
    rows.map(async (s) => ({
      id: s.id,
      title: s.title,
      prompt: s.prompt,
      shareToken: s.shareToken,
      creatorName: s.creatorName,
      createdAt: s.createdAt,
      likeCount: s.likeCount,
      liked: likedSet.has(s.id),
      objectPath: s.objectPath, // lets a viewer push it into the video generator
      url: await storageService.getObjectEntitySignedUrl(s.objectPath, 3600),
    })),
  );
  res.json({ soundtracks });
});

// Like a public soundtrack (idempotent).
router.post("/music/soundtracks/:id/like", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const id = String(req.params.id || "");
  const [row] = await db.select().from(soundtracksTable).where(eq(soundtracksTable.id, id)).limit(1);
  if (!row || !row.isPublic || row.deletedAt) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const likeCount = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(soundtrackLikesTable)
      .values({ userId: req.user!.id, soundtrackId: id })
      .onConflictDoNothing()
      .returning();
    if (inserted.length > 0) {
      await tx.update(soundtracksTable).set({ likeCount: sql`${soundtracksTable.likeCount} + 1` }).where(eq(soundtracksTable.id, id));
    }
    const [s] = await tx.select({ likeCount: soundtracksTable.likeCount }).from(soundtracksTable).where(eq(soundtracksTable.id, id)).limit(1);
    return s?.likeCount ?? 0;
  });
  res.json({ liked: true, likeCount });
});

// Unlike a public soundtrack (idempotent).
router.delete("/music/soundtracks/:id/like", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const id = String(req.params.id || "");
  const likeCount = await db.transaction(async (tx) => {
    const deleted = await tx
      .delete(soundtrackLikesTable)
      .where(and(eq(soundtrackLikesTable.userId, req.user!.id), eq(soundtrackLikesTable.soundtrackId, id)))
      .returning();
    if (deleted.length > 0) {
      await tx.update(soundtracksTable).set({ likeCount: sql`GREATEST(${soundtracksTable.likeCount} - 1, 0)` }).where(eq(soundtracksTable.id, id));
    }
    const [s] = await tx.select({ likeCount: soundtracksTable.likeCount }).from(soundtracksTable).where(eq(soundtracksTable.id, id)).limit(1);
    return s?.likeCount ?? 0;
  });
  res.json({ liked: false, likeCount });
});

// Toggle a Soundtrack public (mints a share token on first publish) or private.
router.post("/music/soundtracks/:id/public", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const makePublic = req.body?.isPublic !== false; // default to publishing
  const [row] = await db
    .select()
    .from(soundtracksTable)
    .where(and(eq(soundtracksTable.id, String(req.params.id)), eq(soundtracksTable.userId, req.user.id)))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const shareToken = row.shareToken ?? randomUUID().replace(/-/g, "");
  await db
    .update(soundtracksTable)
    .set({ isPublic: makePublic, shareToken })
    .where(eq(soundtracksTable.id, row.id));
  res.json({ isPublic: makePublic, shareToken, sharePath: `/s/${shareToken}` });
});

// Public resolve by share token (no auth) — powers share links / public gallery.
router.get("/music/shared/:token", async (req: Request, res: Response) => {
  const [row] = await db
    .select()
    .from(soundtracksTable)
    .where(and(eq(soundtracksTable.shareToken, String(req.params.token)), eq(soundtracksTable.isPublic, true), isNull(soundtracksTable.deletedAt)))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json({
    title: row.title,
    prompt: row.prompt,
    provider: row.provider,
    createdAt: row.createdAt,
    url: await storageService.getObjectEntitySignedUrl(row.objectPath, 3600),
  });
});

export default router;
