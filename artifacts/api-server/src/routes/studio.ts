import { Router } from "express";
import { db, lockActiveCredits } from "@workspace/db";
import {
  jobsTable,
  creditsTable,
  usersTable,
  imageAssetsTable,
  editorProjectsTable,
  videosTable,
  soundtracksTable,
} from "@workspace/db";
import { eq, and, gte, ne, count, sql, inArray, isNull, desc } from "drizzle-orm";
import { randomUUID } from "crypto";
import { z } from "zod";
import { FREE_EDITOR_EXPORTS_PER_MONTH, EDITOR_OVERAGE_COST, TRIAL_LYRIC_EXPORTS } from "../lib/editorCost.js";
import { LYRIC_OVERLAY_COST, LYRIC_ALIGN_COST, TRIAL_FREE_ALIGNS } from "../lib/creditCost.js";
import { MAX_LYRICS_LENGTH } from "../lib/lyricLimits.js";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage.js";
import { editorLayersShape, validateEditorTiming, MAX_EDITOR_SECONDS } from "../lib/editorLayersSchema.js";

const router = Router();
const storage = new ObjectStorageService();

const SegmentSchema = z.object({
  objectPath: z.string().min(1),
  kind: z.enum(["video", "photo"]),
  durationSec: z.number().positive().max(MAX_EDITOR_SECONDS),
  // Trim seconds off the front / back of a video clip (ignored for photos).
  trimStart: z.number().min(0).max(MAX_EDITOR_SECONDS).optional(),
  trimEnd: z.number().min(0).max(MAX_EDITOR_SECONDS).optional(),
});

function effectiveSegmentDuration(segment: z.infer<typeof SegmentSchema>) {
  const duration = segment.durationSec;
  if (segment.kind !== "video") return duration;
  const minimumKept = Math.min(0.3, duration);
  const maximumTotalTrim = Math.max(0, duration - minimumKept);
  const front = Math.min(segment.trimStart ?? 0, maximumTotalTrim);
  const back = Math.min(segment.trimEnd ?? 0, Math.max(0, maximumTotalTrim - front));
  return Math.max(minimumKept, duration - front - back);
}

const RenderSchema = z.object({
  ...editorLayersShape,
  name: z.string().max(120).optional(),
  segments: z.array(SegmentSchema).min(1).max(500),
  music: z
    .object({
      objectPath: z.string().min(1),
      mode: z.enum(["mix", "replace"]).default("mix"),
      volume: z.number().min(0).max(1).default(0.6),
      loop: z.boolean().optional(),
      fade: z.boolean().optional(),
    })
    .optional(),
  transition: z
    .object({
      // Full transition set (see the worker's XFADE map). Legacy/unknown values
      // still validate and are treated as a hard cut on render.
      type: z.enum([
        "none", "crossfade", "fadeblack", "fadewhite", "dissolve", "pixelize",
        "wipeleft", "wiperight", "wipeup", "wipedown",
        "slideleft", "slideright", "slideup", "slidedown",
        "circleopen", "circleclose", "radial",
        // legacy values kept for backwards compatibility (render as hard cut)
        "wipe", "slide", "circle", "zoomin",
      ]),
      durationSec: z.number().min(0.2).max(2).default(0.5),
    })
    .optional(),
  resolution: z.enum(["720p", "1080p"]).default("720p"),
  orientation: z.enum(["landscape", "portrait"]).default("landscape"),
  acceptCopyright: z.boolean().optional(),
  // Karaoke lyric burn (same engine as the generator): plain text, LRC, or
  // word-level enhanced LRC.
  lyricsText: z.string().max(MAX_LYRICS_LENGTH).optional(),
}).superRefine(validateEditorTiming);

const ProjectSegmentSchema = SegmentSchema.extend({
  name: z.string().trim().min(1).max(120),
  sourceVideoId: z.string().trim().min(1).nullable().optional(),
}).strict();

const ProjectManifestSchema = z.object({
  ...editorLayersShape,
  version: z.literal(1),
  segments: z.array(ProjectSegmentSchema).min(1).max(500),
  music: z.object({
    name: z.string().trim().min(1).max(120),
    objectPath: z.string().min(1),
    mode: z.enum(["mix", "replace"]),
    volume: z.number().min(0).max(1),
    loop: z.boolean(),
    fade: z.boolean(),
  }).strict().nullable().optional(),
  transition: z.object({
    type: z.enum([
      "none", "crossfade", "fadeblack", "fadewhite", "dissolve", "pixelize",
      "wipeleft", "wiperight", "wipeup", "wipedown", "slideleft", "slideright",
      "slideup", "slidedown", "circleopen", "circleclose", "radial",
      "wipe", "slide", "circle", "zoomin",
    ]),
    durationSec: z.number().min(0.2).max(2),
  }).strict(),
  resolution: z.enum(["720p", "1080p"]),
  orientation: z.enum(["landscape", "portrait"]),
  videoName: z.string().max(120),
  sourceVideoId: z.string().trim().min(1).nullable(),
  karaokeEnabled: z.boolean(),
  lyricsText: z.string().max(MAX_LYRICS_LENGTH),
  lyricsSyncSource: z.enum(["music", "video"]),
  beatsPerPhoto: z.number().positive().max(128),
}).strict().superRefine(validateEditorTiming);

const ProjectInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  manifest: ProjectManifestSchema,
}).strict();

const ProjectUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  manifest: ProjectManifestSchema.optional(),
}).strict().refine((value) => value.name !== undefined || value.manifest !== undefined, {
  message: "Provide a project name or manifest.",
});

type ProjectManifest = z.infer<typeof ProjectManifestSchema>;
type EditorMediaSegment = {
  objectPath: string;
  kind: "video" | "photo";
  name?: string;
};
type EditorMusicReference = {
  objectPath: string;
  name?: string;
};

async function ensureStored(path: string): Promise<boolean> {
  try {
    await storage.getObjectEntityFile(path);
    return true;
  } catch (error) {
    if (error instanceof ObjectNotFoundError) return false;
    throw error;
  }
}

async function validateOwnedEditorMedia(
  userId: string,
  segments: EditorMediaSegment[],
  music?: EditorMusicReference | null,
  audioClips: EditorMusicReference[] = [],
): Promise<string | null> {
  const imagePaths = [...new Set(segments.filter((s) => s.kind === "photo").map((s) => s.objectPath))];
  const videoPaths = [...new Set(segments.filter((s) => s.kind === "video").map((s) => s.objectPath))];
  const ownedImages = imagePaths.length
    ? await db.select({ objectPath: imageAssetsTable.objectPath }).from(imageAssetsTable).where(and(
        eq(imageAssetsTable.userId, userId),
        isNull(imageAssetsTable.deletedAt),
        inArray(imageAssetsTable.objectPath, imagePaths),
      ))
    : [];
  const ownedVideos = videoPaths.length
    ? await db.select({ id: videosTable.id, objectPath: videosTable.videoObjectPath }).from(videosTable).where(and(
        eq(videosTable.userId, userId),
        isNull(videosTable.deletedAt),
        inArray(videosTable.videoObjectPath, videoPaths),
      ))
    : [];
  const ownedImagePaths = new Set(ownedImages.map((row) => row.objectPath));
  const ownedVideoPaths = new Set(ownedVideos.map((row) => row.objectPath));
  const userUploadPrefix = `/objects/uploads/${userId}/`;
  const userAudioPrefix = `/objects/audio/${userId}/`;

  for (const segment of segments) {
    const ownerScopedUpload = segment.objectPath.startsWith(userUploadPrefix);
    const ownedAsset = segment.kind === "photo"
      ? ownedImagePaths.has(segment.objectPath)
      : ownedVideoPaths.has(segment.objectPath);
    if (!ownerScopedUpload && !ownedAsset) {
      return `“${segment.name ?? "Selected media"}” is no longer available to this account. Re-add or remove it before continuing.`;
    }
  }

  const audioReferences = [...(music ? [music] : []), ...audioClips];
  for (const audio of audioReferences) {
    const musicPath = audio.objectPath;
    const ownerScoped = musicPath.startsWith(userUploadPrefix) || musicPath.startsWith(userAudioPrefix);
    const [track] = ownerScoped ? [] : await db.select({ id: soundtracksTable.id }).from(soundtracksTable).where(and(
      eq(soundtracksTable.userId, userId),
      eq(soundtracksTable.objectPath, musicPath),
      isNull(soundtracksTable.deletedAt),
    )).limit(1);
    if (!ownerScoped && !track) return `The music track “${audio.name ?? "Selected music"}” is no longer available.`;
  }

  const paths = [...new Set([
    ...segments.map((segment) => segment.objectPath),
    ...audioReferences.map((audio) => audio.objectPath),
  ])];
  const available = await Promise.all(paths.map(ensureStored));
  const missingIndex = available.findIndex((value) => !value);
  return missingIndex >= 0 ? `A saved media file is missing (${paths[missingIndex]}). Re-add it before saving.` : null;
}

async function validateProjectMedia(userId: string, manifest: ProjectManifest): Promise<string | null> {
  const mediaError = await validateOwnedEditorMedia(userId, [
    ...manifest.segments,
    ...(manifest.overlays ?? []).map((layer) => ({ ...layer, kind: layer.kind === "image" ? "photo" as const : "video" as const })),
  ], manifest.music, manifest.audioClips);
  if (mediaError) return mediaError;
  const sourceIds = [...new Set([
    ...manifest.segments.flatMap((segment) => segment.sourceVideoId ? [segment.sourceVideoId] : []),
    ...(manifest.sourceVideoId ? [manifest.sourceVideoId] : []),
  ])];
  if (sourceIds.length) {
    const sources = await db.select({ id: videosTable.id }).from(videosTable).where(and(
      eq(videosTable.userId, userId),
      isNull(videosTable.deletedAt),
      inArray(videosTable.id, sourceIds),
    ));
    if (sources.length !== sourceIds.length) return "A referenced Gallery video is no longer available.";
  }
  return null;
}

function projectResponse(project: typeof editorProjectsTable.$inferSelect) {
  return {
    ...project,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}

router.get("/studio/projects", async (req, res) => {
  if (!req.isAuthenticated()) return void res.status(401).json({ error: "Unauthorized" });
  const projects = await db.select({
    id: editorProjectsTable.id,
    name: editorProjectsTable.name,
    lastVideoId: editorProjectsTable.lastVideoId,
    createdAt: editorProjectsTable.createdAt,
    updatedAt: editorProjectsTable.updatedAt,
  }).from(editorProjectsTable).where(eq(editorProjectsTable.userId, req.user.id))
    .orderBy(desc(editorProjectsTable.updatedAt));
  res.json(projects.map((project) => ({
    ...project,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  })));
});

router.post("/studio/projects", async (req, res) => {
  if (!req.isAuthenticated()) return void res.status(401).json({ error: "Unauthorized" });
  const parsed = ProjectInputSchema.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid project." });
  const mediaError = await validateProjectMedia(req.user.id, parsed.data.manifest);
  if (mediaError) return void res.status(403).json({ error: mediaError, code: "PROJECT_MEDIA_UNAVAILABLE" });
  const [project] = await db.insert(editorProjectsTable).values({
    id: randomUUID(),
    userId: req.user.id,
    name: parsed.data.name,
    manifest: parsed.data.manifest,
  }).returning();
  res.status(201).json(projectResponse(project!));
});

router.get("/studio/projects/:id", async (req, res) => {
  if (!req.isAuthenticated()) return void res.status(401).json({ error: "Unauthorized" });
  const [project] = await db.select().from(editorProjectsTable).where(and(
    eq(editorProjectsTable.id, req.params.id),
    eq(editorProjectsTable.userId, req.user.id),
  )).limit(1);
  if (!project) return void res.status(404).json({ error: "Project not found." });
  const parsed = ProjectManifestSchema.safeParse(project.manifest);
  if (!parsed.success) return void res.status(422).json({ error: "This project uses an unsupported saved format." });
  const mediaError = await validateProjectMedia(req.user.id, parsed.data);
  if (mediaError) return void res.status(409).json({ error: mediaError, code: "PROJECT_MEDIA_UNAVAILABLE" });
  res.json(projectResponse(project));
});

router.patch("/studio/projects/:id", async (req, res) => {
  if (!req.isAuthenticated()) return void res.status(401).json({ error: "Unauthorized" });
  const parsed = ProjectUpdateSchema.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid project update." });
  const [existing] = await db.select({ id: editorProjectsTable.id }).from(editorProjectsTable).where(and(
    eq(editorProjectsTable.id, req.params.id),
    eq(editorProjectsTable.userId, req.user.id),
  )).limit(1);
  if (!existing) return void res.status(404).json({ error: "Project not found." });
  if (parsed.data.manifest) {
    const mediaError = await validateProjectMedia(req.user.id, parsed.data.manifest);
    if (mediaError) return void res.status(403).json({ error: mediaError, code: "PROJECT_MEDIA_UNAVAILABLE" });
  }
  const [project] = await db.update(editorProjectsTable).set({
    ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
    ...(parsed.data.manifest !== undefined ? { manifest: parsed.data.manifest } : {}),
    updatedAt: new Date(),
  }).where(and(eq(editorProjectsTable.id, req.params.id), eq(editorProjectsTable.userId, req.user.id))).returning();
  res.json(projectResponse(project!));
});

router.delete("/studio/projects/:id", async (req, res) => {
  if (!req.isAuthenticated()) return void res.status(401).json({ error: "Unauthorized" });
  const [deleted] = await db.delete(editorProjectsTable).where(and(
    eq(editorProjectsTable.id, req.params.id),
    eq(editorProjectsTable.userId, req.user.id),
  )).returning({ id: editorProjectsTable.id });
  if (!deleted) return void res.status(404).json({ error: "Project not found." });
  res.status(204).end();
});

// GET /api/studio/quota — this month's free-Remix usage for the current user.
router.get("/studio/quota", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const [{ used }] = await db
    .select({ used: count() })
    .from(jobsTable)
    .where(
      and(
        eq(jobsTable.userId, req.user.id),
        eq(jobsTable.jobType, "editor_render"),
        gte(jobsTable.createdAt, monthStart),
        ne(jobsTable.status, "failed"),
      ),
    );
  // Trial karaoke allowance (see /studio/render): only meaningful for
  // non-subscribed users inside their 7-day trial.
  const [quotaUser] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, req.user.id))
    .limit(1);
  const quotaTrialActive =
    !!quotaUser?.trialEndsAt &&
    new Date(quotaUser.trialEndsAt).getTime() > Date.now() &&
    quotaUser?.subscriptionStatus === "trial";
  let lyricUsed = 0;
  if (quotaTrialActive) {
    const [{ used: lu }] = await db
      .select({ used: count() })
      .from(jobsTable)
      .where(
        and(
          eq(jobsTable.userId, req.user.id),
          eq(jobsTable.jobType, "editor_render"),
          ne(jobsTable.status, "failed"),
          sql`coalesce(${jobsTable.manifest} ->> 'lyricsText', '') <> ''`,
        ),
      );
    lyricUsed = lu;
  }

  res.json({
    used,
    free: FREE_EDITOR_EXPORTS_PER_MONTH,
    remaining: Math.max(0, FREE_EDITOR_EXPORTS_PER_MONTH - used),
    overageCost: EDITOR_OVERAGE_COST,
    trial: quotaTrialActive
      ? {
          lyricUsed,
          lyricFree: 0,
          lyricRemaining: 0,
          lyricOverageCost: LYRIC_OVERLAY_COST,
          alignUsed: quotaUser?.trialAlignsUsed ?? 0,
          alignFree: 0,
          alignRemaining: 0,
          alignCost: LYRIC_ALIGN_COST,
        }
      : null,
  });
});

// POST /api/studio/render — enqueue an editor_render job from a timeline manifest.
router.post("/studio/render", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = RenderSchema.safeParse(req.body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first?.path?.length ? ` (${first.path.join(".")})` : "";
    res.status(400).json({ error: `${first?.message ?? "Invalid render request"}${where}` });
    return;
  }
  const input = parsed.data;

  // The worker reads storage with service credentials, so the render boundary
  // must enforce the same ownership rules as project saving and browser reads.
  const mediaError = await validateOwnedEditorMedia(req.user.id, [
    ...input.segments,
    ...(input.overlays ?? []).map((layer) => ({ ...layer, kind: layer.kind === "image" ? "photo" as const : "video" as const })),
  ], input.music, input.audioClips);
  if (mediaError) {
    res.status(403).json({ error: mediaError, code: "EDITOR_MEDIA_UNAVAILABLE" });
    return;
  }

  // Require the copyright/ownership attestation before rendering uploaded clips.
  if (input.acceptCopyright !== true) {
    res.status(403).json({
      error: "You must confirm you own or are licensed to use these clips before exporting.",
      code: "COPYRIGHT_REQUIRED",
    });
    return;
  }

  const [userRecord] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, req.user.id))
    .limit(1);

  if (!userRecord?.copyrightAcceptedAt) {
    await db.update(usersTable).set({ copyrightAcceptedAt: new Date() }).where(eq(usersTable.id, req.user.id));
  }
  req.log.info({ userId: req.user.id, ip: req.ip }, "Copyright attestation recorded (editor)");

  const isAdmin = !!(
    process.env.ADMIN_EMAIL &&
    userRecord?.email?.toLowerCase() === process.env.ADMIN_EMAIL.toLowerCase()
  );
  const isSubscribed = (userRecord?.subscriptionStatus ?? "none") === "active";
  const trialActive =
    userRecord?.subscriptionStatus === "trial" &&
    !!userRecord.trialEndsAt && new Date(userRecord.trialEndsAt).getTime() > Date.now();
  // Full, free Editor access during the 7-day trial, with a subscription, or for admins.
  const fullAccess = isAdmin || isSubscribed || trialActive;

  // Remix Lab exports stay CLEAN (no watermark) — it's a headline advantage over
  // CapCut, whose free tier stamps one on. The viral "Made with AIBeatSync"
  // watermark lives on the AI *video generator* exports instead (see jobs.ts).
  const watermarkEditor = false;

  const resolution = input.resolution;
  const transition = input.transition;
  const totalDuration = input.segments.reduce((sum, segment) => sum + effectiveSegmentDuration(segment), 0);

  // Freemium Remix Lab: admins/subscribers/trial are unlimited. Everyone else
  // gets FREE_EDITOR_EXPORTS_PER_MONTH free exports per calendar month, then a
  // flat low overage per export.
  const lyricsRequested = !!input.lyricsText?.trim();
  const userId = req.user.id;

  // Quota counting, balance checks, and job insertion run in ONE transaction
  // serialized per-user with an advisory lock, so two simultaneous submissions
  // can't both grab the last free slot or double-spend the same balance.
  type Rejection = { status: number; body: Record<string, unknown> };
  let rejection: Rejection | null = null;
  let chargeCredits = false;
  let chargeAmount = 0;

  const job = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);

    const loadCredits = async () => {
      let userCredits = await lockActiveCredits(tx, userId);
      if (!userCredits) {
        [userCredits] = await tx
          .insert(creditsTable)
          .values({ id: randomUUID(), userId })
          .returning();
      }
      return userCredits;
    };

    // Trial lyric burns consume the same credits as any other paid generation.
    if (lyricsRequested && trialActive && !isAdmin && !isSubscribed) {
        chargeCredits = true;
        chargeAmount = LYRIC_OVERLAY_COST;
        const userCredits = await loadCredits();
        if (userCredits.creditsRemaining < chargeAmount) {
          rejection = {
            status: 402,
            body: {
              error: `Lyric exports cost ${chargeAmount} credits (you have ${userCredits.creditsRemaining}).`,
              code: "INSUFFICIENT_CREDITS",
              creditsRequired: chargeAmount,
              creditsRemaining: userCredits.creditsRemaining,
            },
          };
          return null;
        }
    }

    if (!fullAccess) {
      const monthStart = new Date();
      monthStart.setUTCDate(1);
      monthStart.setUTCHours(0, 0, 0, 0);
      // Count this month's editor renders (exclude failed so a broken render
      // doesn't burn a free slot).
      const [{ used }] = await tx
        .select({ used: count() })
        .from(jobsTable)
        .where(
          and(
            eq(jobsTable.userId, userId),
            eq(jobsTable.jobType, "editor_render"),
            gte(jobsTable.createdAt, monthStart),
            ne(jobsTable.status, "failed"),
          ),
        );

      if (used >= FREE_EDITOR_EXPORTS_PER_MONTH) {
        chargeCredits = true;
        chargeAmount = EDITOR_OVERAGE_COST;
        const userCredits = await loadCredits();
        if (userCredits.creditsRemaining < chargeAmount) {
          rejection = {
            status: 402,
            body: {
              error: `You've used your ${FREE_EDITOR_EXPORTS_PER_MONTH} free Remix exports this month. Each extra export is ${chargeAmount} credits (you have ${userCredits.creditsRemaining}). Subscribe for unlimited editing.`,
              code: "FREE_EXPORTS_USED",
              creditsRequired: chargeAmount,
              creditsRemaining: userCredits.creditsRemaining,
            },
          };
          return null;
        }
      }
    }

    const manifest = {
      segments: input.segments,
      overlays: input.overlays,
      textCards: input.textCards,
      audioClips: input.audioClips,
      music: input.music,
      transition,
      resolution,
      orientation: input.orientation,
      // Free-tier Remix exports carry the "Made with AIBeatSync" watermark; only
      // Pro/Studio (and admins) render clean. Same rule as the video generator.
      watermark: watermarkEditor,
      chargeCredits,
      chargeAmount,
      lyricsText: input.lyricsText?.trim() || null,
    };

    const [inserted] = await tx
      .insert(jobsTable)
      .values({
        id: randomUUID(),
        userId,
        jobType: "editor_render",
        manifest: manifest as unknown as Record<string, unknown>,
        status: "queued", // straight into the worker queue — no AI approval step
        prompt: input.name ?? "Studio export",
        progressPercent: 0,
      })
      .returning();
    return inserted;
  });

  if (!job) {
    const r: Rejection = rejection ?? { status: 500, body: { error: "Failed to queue render" } };
    res.status(r.status).json(r.body);
    return;
  }

  // Estimate shown to the client (0 when the export is free).
  const creditCost = chargeAmount;
  const jobId = job.id;

  req.log.info(
    { userId: req.user.id, jobId, totalDuration, creditCost, fullAccess, trialActive },
    "Editor render queued",
  );

  res.status(201).json({ job, estimatedCost: creditCost, charged: chargeCredits });
});

export default router;
