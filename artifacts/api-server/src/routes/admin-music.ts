// Admin-only AI song generation. Gated to ADMIN_EMAIL while the feature is
// being wired up — not exposed in the product yet. Generates a song, stores
// it in object storage, and returns a signed URL + the objectPath so it can
// be fed straight into the video generator (same shape as an upload).

import { Router, type IRouter, type Request, type Response } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { db, creditsTable, usersTable, soundtracksTable, soundtrackLikesTable, lockActiveCredits, splitCreditDebit, debitCreditColumns, activeWelcomeRefund, refundCreditColumns } from "@workspace/db";
import { eq, sql, and, desc, isNull, inArray } from "drizzle-orm";
import {
  generateSong,
  getActiveMusicProvider,
  inferVocalDurationSeconds,
  isUsableElevenLabsMusicCredential,
  loopAudioToLength,
  MAX_SONG_SECONDS,
  type MusicProvider,
} from "../lib/musicApis.js";
import { generateLyrics, lyricsProviderAvailable } from "../lib/lyricsGen.js";
import {
  calculateSongCost,
  freeSoundtracksFor,
  SONG_VOCAL_CREDITS,
  VOCAL_SONG_CREDITS_PER_MINUTE,
} from "../lib/creditCost.js";
import { notifyFeatureRequest } from "../lib/notifications.js";
import { getUncachableStripeClient } from "../lib/stripeClient.js";
import { ObjectStorageService } from "../lib/objectStorage.js";
import { logger } from "../lib/logger.js";

async function getUserTier(user: { stripeSubscriptionId?: string | null }): Promise<string | null> {
  if (!user.stripeSubscriptionId) return null;
  try {
    const stripe = await getUncachableStripeClient();
    const sub = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);
    const lk = sub.items.data[0]?.price?.lookup_key ?? null;
    if (!lk) return null;
    for (const tier of ["studio", "pro", "starter"]) if (lk.startsWith(tier)) return tier;
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
    instrumentalMusicModel:
      process.env.PIXAZO_MUSIC_MODEL || "stable-audio-3-small-music-text-to-audio",
    vocalMusicModel: process.env.ELEVENLABS_MUSIC_MODEL || "music_v2",
    vocalCreditsPerMinute: VOCAL_SONG_CREDITS_PER_MINUTE,
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
  // Instrumentals accept an explicit target. Vocal song length is derived from
  // the supplied lyrics because the vocal provider follows lyric structure.
  durationSeconds: z.number().int().min(5).max(300).optional(),
  // Loop the generated clip (via ffmpeg, free) to this length to match a video.
  loopToSeconds: z.number().int().min(1).max(MAX_SONG_SECONDS).optional(),
  provider: z.enum(["simulation", "acestep", "musicgen", "pixazo", "elevenlabs"]).optional(),
  // Generate a full VOCAL song (Eleven Music) instead of an instrumental.
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
  const durationSeconds = wantsVocals
    ? inferVocalDurationSeconds(parsed.data.lyrics)
    : parsed.data.durationSeconds ?? 30;
  const cost = calculateSongCost(durationSeconds, wantsVocals);

  // Preserve existing paid subscribers' monthly included instrumental tracks.
  // Free signup tracks and free vocal songs have been replaced by welcome credits.
  const [user] = admin ? [null] : await db.select().from(usersTable)
    .where(eq(usersTable.id, req.user.id)).limit(1);
  const tier = !wantsVocals && user?.subscriptionStatus === "active"
    ? await getUserTier(user) : null;
  const allowance = !wantsVocals && user?.subscriptionStatus === "active"
    ? freeSoundtracksFor(tier) || freeSoundtracksFor("starter") : 0;

  // Reserve before contacting the provider; a row lock serializes both
  // included-track claims and credit debits across simultaneous requests.
  let reservedSubscription = 0;
  let reservedTopup = 0;
  let reservedWelcome = 0;
  let claimedFreeResetAt: Date | null = null;
  let freeRemaining = 0;
  if (!admin) {
    const reservation = await db.transaction(async (tx) => {
      await tx.insert(creditsTable).values({ id: randomUUID(), userId: req.user.id })
        .onConflictDoNothing({ target: creditsTable.userId });
      const credits = await lockActiveCredits(tx, req.user.id);
      if (!credits) throw new Error("Credits account unavailable.");
      const now = new Date();
      const resetAt = credits.freeSoundtracksResetAt;
      const used = !resetAt || resetAt.getTime() <= now.getTime()
        ? 0 : credits.freeSoundtracksUsed;
      if (allowance > used) {
        const nextReset = resetAt && resetAt.getTime() > now.getTime()
          ? resetAt
          : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate(),
              now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds(), now.getUTCMilliseconds()));
        await tx.update(creditsTable).set({
          freeSoundtracksUsed: used + 1,
          freeSoundtracksResetAt: nextReset,
        }).where(eq(creditsTable.userId, req.user.id));
        return { charged: true as const, free: true as const, resetAt: nextReset, remaining: allowance - used - 1 };
      }
      if (credits.creditsRemaining < cost) return { remaining: credits.creditsRemaining, charged: false as const };
      const split = splitCreditDebit(credits, cost);
      await tx.update(creditsTable).set({
        ...debitCreditColumns(split, cost),
        updatedAt: new Date(),
      }).where(eq(creditsTable.userId, req.user.id));
      return { charged: true as const, free: false as const, ...split };
    });
    if (!reservation.charged) {
      res.status(402).json({
        error: `This song costs ${cost} credits but you have ${reservation.remaining}.`,
        code: "INSUFFICIENT_CREDITS",
        creditsRequired: cost,
        creditsRemaining: reservation.remaining,
      });
      return;
    }
    if (reservation.free) {
      claimedFreeResetAt = reservation.resetAt;
      freeRemaining = reservation.remaining;
    } else {
      reservedSubscription = reservation.subscription;
      reservedTopup = reservation.topup;
      reservedWelcome = reservation.welcome;
    }
  }

  let delivered = false;
  try {
    const song = await generateSong({
      prompt: parsed.data.prompt,
      lyrics: parsed.data.lyrics,
      durationSeconds,
      provider: parsed.data.provider as MusicProvider | undefined,
      withVocals: wantsVocals,
      lyricsOptimizer: parsed.data.lyricsOptimizer,
    });

    // Optionally loop the (short, cheap) clip to a longer length — free ffmpeg,
    // no extra provider cost, so you pay only for the short generation.
    let audioBuffer = song.audioBuffer;
    let ext = song.ext;
    let loopedToSeconds: number | null = null;
    if (parsed.data.loopToSeconds && parsed.data.loopToSeconds > durationSeconds) {
      const looped = await loopAudioToLength(song.audioBuffer, song.ext, parsed.data.loopToSeconds);
      audioBuffer = looped.buffer;
      ext = looped.ext;
      loopedToSeconds = parsed.data.loopToSeconds;
    }

    const songId = randomUUID();
    const objectPath = await storageService.uploadAudioBuffer(audioBuffer, songId, ext);
    const url = await storageService.getObjectEntitySignedUrl(objectPath, 3600);

    // Persist to the user's Soundtracks library (play/download/reuse/share).
    // Non-fatal: if this fails (e.g. the table isn't migrated yet), the user
    // still gets their generated track back rather than losing the generation.
    const title = parsed.data.prompt.trim().split(/\s+/).slice(0, 5).join(" ") || "AI Music";
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
        durationSeconds,
        loopedToSeconds,
        provider: song.provider,
      });
      // A durable library track is owed its reservation even if subsequent
      // logging or response serialization fails.
      delivered = true;
    } catch (persistErr) {
      savedToLibrary = false;
      logger.error({ err: persistErr, songId }, "Soundtrack generated but failed to save to library (is the soundtracks table migrated?)");
    }

    logger.info({ songId, provider: song.provider, cost, admin, loopedToSeconds, savedToLibrary }, "Soundtrack generated");
    res.json({
      songId,
      objectPath, // feed this straight into the video generator as the audio source
      url,
      provider: song.provider,
      hasVocals: song.hasVocals,
      ext,
      loopedToSeconds, // null unless the clip was looped
      creditsCharged: admin || claimedFreeResetAt ? 0 : cost,
      wasFree: admin || !!claimedFreeResetAt,
      freeRemaining: admin ? null : freeRemaining,
      freeVocalSongsRemaining: 0,
      savedToLibrary, // false if the library insert failed (track still returned)
    });
    delivered = true;
  } catch (err) {
    if (!delivered && !res.headersSent && claimedFreeResetAt) {
      await db.update(creditsTable)
        .set({ freeSoundtracksUsed: sql`GREATEST(${creditsTable.freeSoundtracksUsed} - 1, 0)` })
        .where(and(eq(creditsTable.userId, req.user.id),
          eq(creditsTable.freeSoundtracksResetAt, claimedFreeResetAt)))
        .catch((restoreErr) => logger.error({ err: restoreErr, userId: req.user!.id },
          "Failed to restore included soundtrack after generation failure"));
    } else if (!delivered && !res.headersSent && !admin) {
      await db.transaction(async (tx) => {
        const welcomeRefund = await activeWelcomeRefund(tx, req.user!.id, reservedWelcome);
        await tx
        .update(creditsTable)
        .set({
          ...refundCreditColumns({ welcome: reservedWelcome, subscription: reservedSubscription, topup: reservedTopup }, welcomeRefund),
          updatedAt: new Date(),
        })
        .where(eq(creditsTable.userId, req.user!.id));
      })
        .catch((restoreErr) => {
          logger.error(
            { err: restoreErr, userId: req.user!.id },
            "Failed to refund song reservation after generation failure",
          );
        });
    }
    logger.error({ err }, "Admin song generation failed");
    if (!res.headersSent) {
      res.status(500).json({
        error: err instanceof Error ? err.message : "Song generation failed",
      });
    }
  }
});

// Paid subscribers retain their monthly instrumental allowance; everyone
// else (and every vocal generation) uses credits.
router.get("/music/soundtracks-status", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const admin = isAdmin(req.user.email);
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.user.id)).limit(1);
  const credits = await db.transaction((tx) => lockActiveCredits(tx, req.user.id));
  const active = (user?.subscriptionStatus ?? "none") === "active";
  const tier = active ? await getUserTier(user ?? {}) : null;
  const freeAllowance = active
    ? freeSoundtracksFor(tier) || freeSoundtracksFor("starter") : 0;
  const resetAt = credits?.freeSoundtracksResetAt;
  const freeUsed = active && resetAt && resetAt.getTime() > Date.now()
    ? credits?.freeSoundtracksUsed ?? 0 : 0;

  res.json({
    admin, // admins generate unlimited/free
    enabled: SONG_GENERATOR_PUBLIC || admin, // whether this user can generate now
    tier,
    isSignupBonus: false,
    freeAllowance,
    freeUsed,
    freeRemaining: Math.max(0, freeAllowance - freeUsed),
    freeResetAt: active && resetAt && resetAt.getTime() > Date.now() ? resetAt : null,
    creditsRemaining: credits?.creditsRemaining ?? 0,
    subscriptionActive: active,
    // Vocal (with-lyrics) song generation: duration-based credit rate +
    // whether the Eleven Music model is configured.
    vocalCost: SONG_VOCAL_CREDITS,
    vocalCreditsPerMinute: VOCAL_SONG_CREDITS_PER_MINUTE,
    freeVocalSongsRemaining: 0,
    vocalsEnabled:
      isUsableElevenLabsMusicCredential() || !!process.env.PIXAZO_API_KEY,
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
      isCreatorAnonymous: s.isCreatorAnonymous,
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
      isCreatorAnonymous: soundtracksTable.isCreatorAnonymous,
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
      creatorName: s.isCreatorAnonymous ? "Anonymous" : s.creatorName,
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

// Update a Soundtrack's Explore visibility and per-post creator attribution.
router.post("/music/soundtracks/:id/public", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const makePublic = req.body?.isPublic !== false; // default to publishing
  const isCreatorAnonymous =
    typeof req.body?.isCreatorAnonymous === "boolean"
      ? req.body.isCreatorAnonymous
      : undefined;
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
    .set({
      isPublic: makePublic,
      shareToken,
      ...(isCreatorAnonymous === undefined ? {} : { isCreatorAnonymous }),
    })
    .where(eq(soundtracksTable.id, row.id));
  res.json({
    isPublic: makePublic,
    isCreatorAnonymous:
      isCreatorAnonymous ?? row.isCreatorAnonymous,
    shareToken,
    sharePath: `/s/${shareToken}`,
  });
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
