import { randomUUID } from "crypto";
import { Router } from "express";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { creditsTable, db, jobsTable, soundtracksTable, usersTable, lockActiveCredits, splitCreditDebit, debitCreditColumns } from "@workspace/db";
import { analyzeAudioBuffer } from "../lib/audioAnalysis.js";
import {
  defaultNarrationVoiceId,
  isAllowedNarrationVoice,
  isOwnerScopedNarrationMusicPath,
  MAX_SCRIPT_CHARS,
  MIN_SCRIPT_CHARS,
  narrationCost,
  narrationMusicSurcharge,
  NARRATION_MUSIC_SOURCES,
  NARRATION_VOICES,
  narrationVoicePreview,
  resolveNarrationMusicSource,
  type NarrationMusicSource,
} from "../lib/narration.js";
import { ObjectStorageService } from "../lib/objectStorage.js";
import { canCreateCreditFundedMediaWithPurchases } from "../lib/paidCreditEntitlement.js";

const router = Router();
const storage = new ObjectStorageService();
const bodySchema = z.object({
  script: z.string().trim().min(MIN_SCRIPT_CHARS).max(MAX_SCRIPT_CHARS),
  title: z.string().trim().max(120).optional(),
  voiceId: z.string().trim().max(100).optional(),
  includeMusic: z.boolean().optional(),
  musicSource: z.enum(NARRATION_MUSIC_SOURCES).optional(),
  musicPrompt: z.string().trim().max(300).optional(),
  soundtrackId: z.string().trim().max(100).optional(),
  musicObjectPath: z.string().trim().max(500).optional(),
  musicTitle: z.string().trim().max(200).optional(),
}).strict();

type ResolvedMusic = {
  source: NarrationMusicSource;
  objectPath?: string;
  title?: string;
};

class MusicInputError extends Error {}

export async function resolveMusic(userId: string, input: z.infer<typeof bodySchema>): Promise<ResolvedMusic> {
  const source = resolveNarrationMusicSource(input);
  if (source === "none") {
    if (input.musicPrompt || input.soundtrackId || input.musicObjectPath) {
      throw new MusicInputError("Remove music details or select a music source.");
    }
    return { source };
  }
  if (source === "generated") {
    if (input.soundtrackId || input.musicObjectPath) {
      throw new MusicInputError("Generated music cannot use an existing audio file.");
    }
    return { source };
  }
  if (input.musicPrompt) throw new MusicInputError("A music prompt is only valid for generated music.");

  let objectPath: string;
  let title: string | undefined;
  if (source === "soundtrack") {
    const selector = input.soundtrackId
      ? eq(soundtracksTable.id, input.soundtrackId)
      : eq(soundtracksTable.objectPath, input.musicObjectPath ?? "");
    const [track] = await db.select({
      objectPath: soundtracksTable.objectPath,
      title: soundtracksTable.title,
    }).from(soundtracksTable).where(and(
      eq(soundtracksTable.userId, userId),
      isNull(soundtracksTable.deletedAt),
      selector,
    )).limit(1);
    if (!track) throw new MusicInputError("Music not found.");
    objectPath = track.objectPath;
    title = track.title ?? undefined;
    if (!/\.(?:mp3|wav|m4a|ogg|aac|flac)$/i.test(objectPath)) {
      throw new MusicInputError("Music is not a valid audio file.");
    }
  } else {
    objectPath = input.musicObjectPath ?? "";
    if (!isOwnerScopedNarrationMusicPath(objectPath, userId)) {
      throw new MusicInputError("Music file not found.");
    }
    const filename = objectPath.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "";
    try {
      title = input.musicTitle || decodeURIComponent(filename);
    } catch {
      title = input.musicTitle || filename;
    }
  }
  try {
    const buffer = await storage.downloadObjectBuffer(objectPath);
    const filename = objectPath.split("/").pop() ?? "";
    const ext = filename.includes(".") ? filename.split(".").pop()!.toLowerCase() : "mp3";
    await analyzeAudioBuffer(buffer, ext);
  } catch {
    throw new MusicInputError("Music file is missing or is not valid audio.");
  }
  const safeTitle = title?.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
  return { source, objectPath, title: safeTitle || "Music track" };
}

function admin(email: string | null | undefined): boolean {
  return Boolean(email && process.env.ADMIN_EMAIL && email.toLowerCase() === process.env.ADMIN_EMAIL.toLowerCase());
}

function narrationTitle(title: unknown, script: unknown): string {
  const requested = typeof title === "string"
    ? title.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120)
    : "";
  if (requested) return requested;
  const scriptTitle = typeof script === "string"
    ? script.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().split(" ").slice(0, 8).join(" ")
    : "";
  return scriptTitle ? `Narration: ${scriptTitle}`.slice(0, 120) : "AI Narration";
}

function view(job: typeof jobsTable.$inferSelect) {
  const meta = job.manifest && typeof job.manifest === "object"
    ? job.manifest as Record<string, unknown>
    : {};
  const charged = Number(meta.chargedCredits ?? 0);
  return {
    id: job.id,
    status: job.status,
    progressPercent: job.progressPercent ?? 0,
    error: job.errorMessage,
    estimatedCost: Number(meta.estimatedCost ?? charged),
    chargedCost: charged,
    refunded: meta.refunded === true,
    title: narrationTitle(meta.title, meta.script),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    ...(job.status === "ready" && job.audioObjectPath ? {
      result: {
        audioObjectPath: job.audioObjectPath,
        audioAnalysis: job.audioAnalysis,
        downloadPath: `/api/narrations/${job.id}/download`,
        handoff: {
          audioSourceType: "upload",
          audioObjectPath: job.audioObjectPath,
          audioAnalysis: job.audioAnalysis,
        },
      },
    } : {}),
  };
}

router.get("/narrations/voices", (req, res) => {
  if (!req.isAuthenticated()) return void res.status(401).json({ error: "Unauthorized" });
  res.json({
    voices: NARRATION_VOICES.map((voice) => ({
      ...voice,
      isDefault: voice.id === defaultNarrationVoiceId(),
      previewPath: `/api/narrations/voices/${voice.id}/preview`,
    })),
    defaultVoiceId: defaultNarrationVoiceId(),
  });
});

router.get("/narrations/voices/:voiceId/preview", async (req, res) => {
  if (!req.isAuthenticated()) return void res.status(401).json({ error: "Unauthorized" });
  if (!isAllowedNarrationVoice(req.params.voiceId)) {
    return void res.status(404).json({ error: "Voice not found" });
  }
  try {
    const audio = await narrationVoicePreview(req.params.voiceId);
    res.setHeader("content-type", "audio/mpeg");
    res.setHeader("cache-control", "private, max-age=86400");
    res.send(audio);
  } catch (error) {
    req.log.error({ error }, "Narration voice preview failed");
    res.status(503).json({ error: "Voice preview is temporarily unavailable." });
  }
});

router.post("/narrations/estimate", async (req, res) => {
  if (!req.isAuthenticated()) return void res.status(401).json({ error: "Unauthorized" });
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "Enter a script between 40 and 39,000 characters." });
  try {
    const music = await resolveMusic(req.user.id, parsed.data);
    res.json({
      scriptCharacters: parsed.data.script.length,
      estimatedCost: narrationCost(parsed.data.script.length, music.source),
      musicCost: narrationMusicSurcharge(music.source),
      musicSource: music.source,
    });
  } catch (error) {
    if (error instanceof MusicInputError) return void res.status(400).json({ error: error.message });
    throw error;
  }
});

router.post("/narrations", async (req, res) => {
  if (!req.isAuthenticated()) return void res.status(401).json({ error: "Unauthorized" });
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    return void res.status(400).json({
      error: "Enter a script between 40 and 39,000 characters and valid narration options.",
      details: parsed.error.flatten(),
    });
  }
  if (parsed.data.voiceId && !isAllowedNarrationVoice(parsed.data.voiceId)) {
    return void res.status(400).json({ error: "Select an available narration voice." });
  }
  let music: ResolvedMusic;
  try {
    music = await resolveMusic(req.user.id, parsed.data);
  } catch (error) {
    if (error instanceof MusicInputError) return void res.status(400).json({ error: error.message });
    throw error;
  }
  if (!process.env.ELEVENLABS_API_KEY) {
    return void res.status(503).json({ error: "AI narration is temporarily unavailable." });
  }
  const idempotencyKey = String(req.get("Idempotency-Key") ?? "").trim();
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
    return void res.status(400).json({ error: "A valid Idempotency-Key header is required." });
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.user.id)).limit(1);
  const isAdmin = admin(user?.email);
  if (!isAdmin && !(await canCreateCreditFundedMediaWithPurchases(db, user))) {
    return void res.status(403).json({
      error: "An active plan, trial, or purchased credit pack is required for AI narration.",
      code: "SUBSCRIPTION_REQUIRED",
    });
  }
  const estimatedCost = narrationCost(parsed.data.script.length, music.source);
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${req.user.id}:${idempotencyKey}`}))`);
    const [existing] = await tx.select().from(jobsTable).where(and(
      eq(jobsTable.userId, req.user.id),
      eq(jobsTable.jobType, "narration"),
      sql`${jobsTable.manifest}->>'idempotencyKey' = ${idempotencyKey}`,
    )).limit(1);
    if (existing) return { job: existing, remaining: null, replay: true };

    let credits = await lockActiveCredits(tx, req.user.id);
    if (!credits) {
      [credits] = await tx.insert(creditsTable).values({ id: randomUUID(), userId: req.user.id }).returning();
    }
    const charged = isAdmin ? 0 : estimatedCost;
    if (!isAdmin && credits.creditsRemaining < charged) {
      return { job: null, remaining: credits.creditsRemaining, replay: false };
    }
    const split = splitCreditDebit(credits, charged);
    const subscriptionDebit = split.subscription;
    const topupDebit = split.topup;
    if (charged > 0) {
      await tx.update(creditsTable).set({
        ...debitCreditColumns(split, charged),
        updatedAt: new Date(),
      }).where(eq(creditsTable.userId, req.user.id));
    }
    const [job] = await tx.insert(jobsTable).values({
      id: randomUUID(),
      userId: req.user.id,
      jobType: "narration",
      status: "queued",
      audioSourceType: null,
      prompt: "AI narration",
      progressPercent: 0,
      manifest: {
        script: parsed.data.script,
        title: narrationTitle(parsed.data.title, parsed.data.script),
        voiceId: parsed.data.voiceId ?? defaultNarrationVoiceId(),
        musicSource: music.source,
        musicPrompt: parsed.data.musicPrompt,
        musicObjectPath: music.objectPath,
        musicTitle: music.title,
        stage: "queued",
        idempotencyKey,
        estimatedCost,
        chargedCredits: charged,
        chargedSubscriptionCredits: subscriptionDebit,
        chargedWelcomeCredits: split.welcome,
        chargedTopupCredits: topupDebit,
        refunded: false,
      },
    }).returning();
    return { job, remaining: credits.creditsRemaining - charged, replay: false };
  });
  if (!result.job) {
    return void res.status(402).json({
      error: `Narration costs ${estimatedCost} credits, but only ${result.remaining} are available.`,
      code: "INSUFFICIENT_CREDITS",
      estimatedCost,
      chargedCost: 0,
      creditsRequired: estimatedCost,
      creditsRemaining: result.remaining,
    });
  }
  res.status(result.replay ? 200 : 202).json({ narration: view(result.job), idempotentReplay: result.replay });
});

router.get("/narrations/:id", async (req, res) => {
  if (!req.isAuthenticated()) return void res.status(401).json({ error: "Unauthorized" });
  const [job] = await db.select().from(jobsTable).where(and(
    eq(jobsTable.id, req.params.id),
    eq(jobsTable.userId, req.user.id),
    eq(jobsTable.jobType, "narration"),
  )).limit(1);
  if (!job) return void res.status(404).json({ error: "Narration not found" });
  res.json({ narration: view(job) });
});

router.post("/narrations/:id/save-to-soundtracks", async (req, res) => {
  if (!req.isAuthenticated()) return void res.status(401).json({ error: "Unauthorized" });
  const soundtrackId = `narration:${req.params.id}`;
  const saved = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${req.user!.id}:${soundtrackId}`}))`);
    const [job] = await tx.select().from(jobsTable).where(and(
      eq(jobsTable.id, req.params.id),
      eq(jobsTable.userId, req.user!.id),
      eq(jobsTable.jobType, "narration"),
      eq(jobsTable.status, "ready"),
    )).limit(1);
    if (!job?.audioObjectPath) return null;

    const audioAnalysis = job.audioAnalysis && typeof job.audioAnalysis === "object"
      ? job.audioAnalysis as Record<string, unknown>
      : {};
    const manifest = job.manifest && typeof job.manifest === "object"
      ? job.manifest as Record<string, unknown>
      : {};
    const title = narrationTitle(req.body?.title || manifest.title, manifest.script);
    const duration = Number(audioAnalysis.durationSeconds);
    const filename = job.audioObjectPath.split("/").pop() ?? "";
    const ext = filename.includes(".") ? filename.split(".").pop()!.toLowerCase() : "mp3";
    const values = {
      userId: req.user!.id,
      title,
      prompt: "Narration audio",
      lyrics: null,
      hasVocals: true,
      objectPath: job.audioObjectPath,
      ext,
      durationSeconds: Number.isFinite(duration) ? Math.max(1, Math.round(duration)) : null,
      provider: "narration",
      isPublic: false,
      shareToken: null,
      deletedAt: null,
    };
    const [existing] = await tx.select({ id: soundtracksTable.id })
      .from(soundtracksTable)
      .where(eq(soundtracksTable.id, soundtrackId))
      .limit(1);
    if (existing) {
      await tx.update(soundtracksTable).set(values).where(and(
        eq(soundtracksTable.id, soundtrackId),
        eq(soundtracksTable.userId, req.user!.id),
      ));
    } else {
      await tx.insert(soundtracksTable).values({ id: soundtrackId, ...values });
    }
    return {
      soundtrack: { id: soundtrackId, title: values.title, objectPath: values.objectPath },
      alreadySaved: Boolean(existing),
    };
  });
  if (!saved) return void res.status(404).json({ error: "Narration audio is not ready." });
  res.json(saved);
});

router.get("/narrations/:id/download", async (req, res) => {
  if (!req.isAuthenticated()) return void res.status(401).json({ error: "Unauthorized" });
  const [job] = await db.select().from(jobsTable).where(and(
    eq(jobsTable.id, req.params.id),
    eq(jobsTable.userId, req.user.id),
    eq(jobsTable.jobType, "narration"),
    eq(jobsTable.status, "ready"),
  )).limit(1);
  if (!job?.audioObjectPath) return void res.status(404).json({ error: "Narration audio is not ready." });
  res.redirect(302, await storage.getObjectEntitySignedUrl(job.audioObjectPath, 300));
});

export default router;