import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { logger } from "../lib/logger.js";
import {
  generateAudioPrompt,
  generateVideoPrompt,
  buildScenePlan,
  MAX_SCENE_BUILDER_SCENES,
  MAX_SCENE_SCRIPT_LENGTH,
  replaceNamedSubjectInScript,
  promptProviderAvailable,
} from "../lib/promptBuilder.js";
import { generateLyrics, lyricsProviderAvailable } from "../lib/lyricsGen.js";
import { planShots } from "../lib/shotPlan.js";
import { db, creditsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { LYRICS_BUILD_COST } from "../lib/creditCost.js";

const router: IRouter = Router();

// Credit helpers — atomic row-locked debit with exact sub/top-up split, and a
// refund that restores exactly the buckets that were debited (same pattern as
// routes/lyrics.ts and routes/teasers.ts).
type ChargeResult =
  | { ok: true; remaining: number; subDebit: number; topDebit: number }
  | { ok: false; remaining: number };

async function chargeCredits(userId: string, cost: number): Promise<ChargeResult> {
  return db.transaction(async (tx) => {
    let [c] = await tx.select().from(creditsTable).where(eq(creditsTable.userId, userId)).limit(1).for("update");
    if (!c) [c] = await tx.insert(creditsTable).values({ id: randomUUID(), userId }).returning();
    if (c!.creditsRemaining < cost) return { ok: false as const, remaining: c!.creditsRemaining };
    const subDebit = Math.min(c!.subscriptionCredits, cost);
    const topDebit = cost - subDebit;
    await tx.update(creditsTable).set({
      subscriptionCredits: sql`subscription_credits - ${subDebit}`,
      topupCredits: sql`topup_credits - ${topDebit}`,
      creditsRemaining: sql`credits_remaining - ${cost}`,
      creditsUsed: sql`credits_used + ${cost}`,
      updatedAt: new Date(),
    }).where(eq(creditsTable.userId, userId));
    return { ok: true as const, remaining: c!.creditsRemaining - cost, subDebit, topDebit };
  });
}
async function refundCredits(userId: string, subDebit: number, topDebit: number): Promise<void> {
  await db.update(creditsTable).set({
    subscriptionCredits: sql`subscription_credits + ${subDebit}`,
    topupCredits: sql`topup_credits + ${topDebit}`,
    creditsRemaining: sql`credits_remaining + ${subDebit + topDebit}`,
    creditsUsed: sql`GREATEST(credits_used - ${subDebit + topDebit}, 0)`,
    updatedAt: new Date(),
  }).where(eq(creditsTable.userId, userId));
}

// Prompt Builder — helper endpoints that turn a plain description into a polished
// prompt for the audio/video engines. Open to all signed-in users: the audio/
// video prompt builders are lightweight text helpers and stay free (rate-limited)
// as a top-of-funnel hook; writing full lyrics is a real deliverable and costs
// credits (LYRICS_BUILD_COST), so trial/free credits have something to spend on.

// ── Light in-memory per-user rate limit (max N requests / window) ─────────────
const RL_WINDOW_MS = 60_000;
const RL_MAX = 30; // generous — text calls are cheap
const hits = new Map<string, number[]>();
function rateLimited(userId: string): boolean {
  const now = Date.now();
  const arr = (hits.get(userId) ?? []).filter((t) => now - t < RL_WINDOW_MS);
  if (arr.length >= RL_MAX) {
    hits.set(userId, arr);
    return true;
  }
  arr.push(now);
  hits.set(userId, arr);
  return false;
}

function guard(req: Request, res: Response): boolean {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  if (rateLimited(req.user.id)) {
    res.status(429).json({ error: "Slow down a moment — too many prompt requests. Try again shortly." });
    return false;
  }
  return true;
}

// Whether the Prompt Builder is backed by a real LLM (vs. template fallback).
router.get("/prompt/status", (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  res.json({
    enabled: true,
    provider: promptProviderAvailable(),
    lyricsProvider: lyricsProviderAvailable(),
    lyricsCost: LYRICS_BUILD_COST,
  });
});

const AudioBody = z.object({ description: z.string().min(2).max(600) });
router.post("/prompt/audio", async (req: Request, res: Response) => {
  if (!guard(req, res)) return;
  const parsed = AudioBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  try {
    res.json(await generateAudioPrompt(parsed.data.description));
  } catch (err) {
    logger.error({ err }, "Audio prompt build failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Prompt build failed" });
  }
});

const VideoBody = z.object({
  description: z.string().min(2).max(600),
  style: z.string().max(40).optional(),
  aspectRatio: z.string().max(10).optional(),
});
router.post("/prompt/video", async (req: Request, res: Response) => {
  if (!guard(req, res)) return;
  const parsed = VideoBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  try {
    const { description, ...opts } = parsed.data;
    res.json(await generateVideoPrompt(description, opts));
  } catch (err) {
    logger.error({ err }, "Video prompt build failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Prompt build failed" });
  }
});

const SceneBuilderBody = z.object({
  story: z.string().trim().min(2).max(MAX_SCENE_SCRIPT_LENGTH),
  sceneCount: z.number().int().min(2).max(MAX_SCENE_BUILDER_SCENES).optional(),
  hasReferenceImage: z.boolean().optional(),
  mode: z.enum(["montage", "narrative"]).optional(),
});

const VideoSceneListBody = z.object({
  story: z.string().trim().min(2).max(MAX_SCENE_SCRIPT_LENGTH),
  sceneCount: z.number().int().min(2).max(MAX_SCENE_BUILDER_SCENES).default(6),
  hasReferenceImage: z.boolean().optional(),
  style: z.string().trim().max(40).optional(),
});

router.post("/prompt/video-scenes", async (req: Request, res: Response) => {
  if (!guard(req, res)) return;
  const parsed = VideoSceneListBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid story." });
    return;
  }
  try {
    const { story, sceneCount, hasReferenceImage, style } = parsed.data;
    const plan = planShots({
      prompt: story,
      style: style || "cinematic",
      hasCharacterReference: Boolean(hasReferenceImage),
      requestedDuration: String(sceneCount * 10),
      generationMode: "narrative",
    });
    const scenes = plan.shots.map((shot, index) => ({
      number: index + 1,
      title: shot.label,
      imagePrompt: shot.prompt,
    }));
    res.json({
      mode: "montage",
      scenes,
      script: scenes.map((scene) => `${scene.number}. ${scene.imagePrompt}`).join("\n"),
      sceneCount: scenes.length,
      hasReferenceImage: Boolean(hasReferenceImage),
      source: "generate-planner",
    });
  } catch (err) {
    logger.error({ err }, "Video scene list build failed");
    res.status(500).json({ error: "Could not build the video scene list." });
  }
});

router.post("/prompt/scene-builder", async (req: Request, res: Response) => {
  if (!guard(req, res)) return;
  const parsed = SceneBuilderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid story." });
    return;
  }
  try {
    res.json(await buildScenePlan(parsed.data));
  } catch (err) {
    logger.error({ err }, "Scene plan build failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Could not build the scene plan." });
  }
});

const ReplaceSubjectBody = z.object({
  script: z.string().min(2).max(12_000),
  namedSubject: z.string().trim().min(2).max(100),
});
router.post("/prompt/replace-subject", async (req: Request, res: Response) => {
  if (!guard(req, res)) return;
  const parsed = ReplaceSubjectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid script or subject." });
    return;
  }
  try {
    res.json(await replaceNamedSubjectInScript(parsed.data.script, parsed.data.namedSubject));
  } catch (err) {
    logger.error({ err }, "Named subject replacement failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Could not update the script." });
  }
});

const LyricsBody = z
  .object({
    theme: z.string().max(300).optional(),
    genre: z.string().max(60).optional(),
    mood: z.string().max(60).optional(),
    // When set, polish/enhance THIS draft instead of writing from scratch.
    lyrics: z.string().max(5000).optional(),
    // Target song length (seconds) — scales how much lyric to write.
    targetSeconds: z.number().int().min(10).max(600).optional(),
    // Allow explicit language (default clean).
    explicit: z.boolean().optional(),
    // Song tempo (BPM) for on-beat singability.
    bpm: z.number().int().min(40).max(240).optional(),
  })
  .refine(
    (d) => (d.theme?.trim().length ?? 0) >= 2 || (d.lyrics?.trim().length ?? 0) >= 2,
    { message: "Provide a theme, or draft lyrics to enhance." },
  );
router.post("/prompt/lyrics", async (req: Request, res: Response) => {
  if (!guard(req, res)) return;
  const parsed = LyricsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  // Charge only when a real LLM will run (the no-key template fallback is free).
  const willUseLLM = lyricsProviderAvailable() !== "template";
  let debit: { subDebit: number; topDebit: number } | null = null;
  if (willUseLLM) {
    const charge = await chargeCredits(user.id, LYRICS_BUILD_COST);
    if (!charge.ok) {
      res.status(402).json({
        error: `Writing lyrics costs ${LYRICS_BUILD_COST} credits but you only have ${charge.remaining}.`,
        code: "INSUFFICIENT_CREDITS",
        creditsRequired: LYRICS_BUILD_COST,
        creditsRemaining: charge.remaining,
      });
      return;
    }
    debit = { subDebit: charge.subDebit, topDebit: charge.topDebit };
  }
  try {
    const result = await generateLyrics({
      theme: parsed.data.theme ?? "",
      genre: parsed.data.genre,
      mood: parsed.data.mood,
      existingLyrics: parsed.data.lyrics,
      targetSeconds: parsed.data.targetSeconds,
      explicit: parsed.data.explicit,
      bpm: parsed.data.bpm,
    });
    let charged = willUseLLM ? LYRICS_BUILD_COST : 0;
    if (debit && parsed.data.lyrics?.trim() && !result.changed) {
      await refundCredits(user.id, debit.subDebit, debit.topDebit);
      debit = null;
      charged = 0;
    }
    res.json({ ...result, charged, enhanced: !!parsed.data.lyrics?.trim() });
  } catch (err) {
    if (debit) await refundCredits(user.id, debit.subDebit, debit.topDebit);
    logger.error({ err }, "Lyrics build failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Lyrics build failed" });
  }
});

export default router;
