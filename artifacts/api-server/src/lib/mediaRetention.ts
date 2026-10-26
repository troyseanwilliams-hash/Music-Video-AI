import {
  db,
  editorProjectsTable,
  imageAssetsTable,
  jobsTable,
  podcastJobsTable,
  soundtracksTable,
  suiteLinksTable,
  usersTable,
  videosTable,
} from "@workspace/db";
import { and, eq, inArray, isNull, lt, ne, notInArray, or, sql } from "drizzle-orm";
import { ObjectStorageService } from "./objectStorage.js";
import { logger } from "./logger.js";
import { sendMediaRetentionNotice } from "./notifications.js";

export const MEDIA_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
const BATCH_SIZE = 10;
const storage = new ObjectStorageService();
let running = false;

const MEDIA_PATH_KEYS = new Set([
  "audioObjectPath",
  "clipPaths",
  "objectPath",
  "previewObjectPath",
  "previewPath",
  "referenceImagePath",
  "thumbnailObjectPath",
  "thumbnailPath",
  "videoObjectPath",
  "fullVideoPath",
]);

export function mediaObjectPaths(
  value: unknown,
  paths = new Set<string>(),
  key?: string,
): Set<string> {
  if (typeof value === "string") {
    if (key && MEDIA_PATH_KEYS.has(key) && value.startsWith("/objects/")) {
      paths.add(value);
    }
  } else if (Array.isArray(value)) {
    for (const item of value) mediaObjectPaths(item, paths, key);
  } else if (value && typeof value === "object") {
    for (const [childKey, item] of Object.entries(value)) {
      mediaObjectPaths(item, paths, childKey);
    }
  }
  return paths;
}

export function membershipExpirationOf(user: {
  subscriptionStatus: string;
  stripeSubscriptionId?: string | null;
  trialEndsAt: Date | null;
  membershipExpiresAt: Date | null;
}): Date | null {
  if (user.subscriptionStatus === "active" || user.subscriptionStatus === "past_due") return null;
  const hasTrialExpiry = user.subscriptionStatus === "trial"
    || (user.subscriptionStatus === "none" && !user.stripeSubscriptionId);
  const expirations = [
    user.membershipExpiresAt,
    ...(hasTrialExpiry ? [user.trialEndsAt] : []),
  ].filter((date): date is Date => date instanceof Date);
  if (!expirations.length) return null;
  return new Date(Math.max(...expirations.map((date) => date.getTime())));
}

async function deleteDueUserMedia(userId: string, now: Date): Promise<void> {
  await db.transaction(async (tx) => {
    const [user] = await tx.select({
      id: usersTable.id,
      email: usersTable.email,
      subscriptionStatus: usersTable.subscriptionStatus,
      stripeSubscriptionId: usersTable.stripeSubscriptionId,
      trialEndsAt: usersTable.trialEndsAt,
      membershipExpiresAt: usersTable.membershipExpiresAt,
      mediaRetentionStartedAt: usersTable.mediaRetentionStartedAt,
      mediaRetentionNoticeSentAt: usersTable.mediaRetentionNoticeSentAt,
      mediaRetentionDeletedAt: usersTable.mediaRetentionDeletedAt,
      billingCheckoutPendingUntil: usersTable.billingCheckoutPendingUntil,
    }).from(usersTable).where(eq(usersTable.id, userId)).for("update").limit(1);
    if (!user || user.mediaRetentionDeletedAt) return;

    const [liveSuite] = await tx.select({ id: suiteLinksTable.id })
      .from(suiteLinksTable)
      .where(and(
        eq(suiteLinksTable.aibeatUserId, userId),
        inArray(suiteLinksTable.subscriptionStatus, ["active", "past_due"]),
      ))
      .limit(1);
    const [activeJob] = await tx.select({ id: jobsTable.id })
      .from(jobsTable)
      .where(and(
        eq(jobsTable.userId, userId),
        notInArray(jobsTable.status, ["ready", "failed"]),
      ))
      .limit(1);
    const expiration = membershipExpirationOf(user);
    const eligible = !liveSuite
      && !activeJob
      && !user.billingCheckoutPendingUntil?.getTime()
      && expiration !== null
      && expiration.getTime() <= now.getTime();

    if (!eligible) {
      if (user.mediaRetentionStartedAt || user.mediaRetentionNoticeSentAt) {
        await tx.update(usersTable).set({
          mediaRetentionStartedAt: null,
          mediaRetentionNoticeSentAt: null,
        }).where(eq(usersTable.id, userId));
      }
      return;
    }

    if (!user.mediaRetentionStartedAt) {
      const sent = await sendMediaRetentionNotice({
        id: userId,
        email: user.email,
        deleteAt: new Date(now.getTime() + MEDIA_RETENTION_MS),
      });
      if (!sent) {
        logger.warn({ userId }, "Media retention paused until the user can be notified");
        return;
      }
      // Existing expired accounts get a full 30-day warning period from
      // rollout, and new expirations are discovered on the hourly sweep.
      await tx.update(usersTable).set({
        mediaRetentionStartedAt: now,
        mediaRetentionNoticeSentAt: now,
      }).where(eq(usersTable.id, userId));
      logger.info({ userId, deleteAt: new Date(now.getTime() + MEDIA_RETENTION_MS) }, "Media retention period started");
      return;
    }

    const retentionStartedAt = user.mediaRetentionStartedAt;
    if (!user.mediaRetentionNoticeSentAt) {
      const sent = await sendMediaRetentionNotice({
        id: userId,
        email: user.email,
        deleteAt: new Date(retentionStartedAt.getTime() + MEDIA_RETENTION_MS),
      });
      if (!sent) return;
      await tx.update(usersTable).set({ mediaRetentionNoticeSentAt: now })
        .where(eq(usersTable.id, userId));
    }

    if (retentionStartedAt.getTime() + MEDIA_RETENTION_MS > now.getTime()) {
      return;
    }

    // Keep the user row locked until storage and database pointers are both
    // removed. Subscription webhooks serialize on this row, so a renewal
    // cannot race this irreversible cleanup.
    const [videos, images, soundtracks, podcasts, jobs, projects] = await Promise.all([
      tx.select().from(videosTable).where(eq(videosTable.userId, userId)),
      tx.select().from(imageAssetsTable).where(eq(imageAssetsTable.userId, userId)),
      tx.select().from(soundtracksTable).where(eq(soundtracksTable.userId, userId)),
      tx.select().from(podcastJobsTable).where(eq(podcastJobsTable.userId, userId)),
      tx.select().from(jobsTable).where(eq(jobsTable.userId, userId)),
      tx.select().from(editorProjectsTable).where(eq(editorProjectsTable.userId, userId)),
    ]);
    const paths = new Set<string>();
    for (const record of [...videos, ...images, ...soundtracks, ...podcasts, ...jobs, ...projects]) {
      mediaObjectPaths(record, paths);
    }
    for (let index = 0; index < Array.from(paths).length; index += 10) {
      await Promise.all(Array.from(paths).slice(index, index + 10).map((path) => storage.deleteObject(path)));
    }

    await tx.delete(videosTable).where(eq(videosTable.userId, userId));
    await tx.delete(imageAssetsTable).where(eq(imageAssetsTable.userId, userId));
    await tx.delete(soundtracksTable).where(eq(soundtracksTable.userId, userId));
    await tx.delete(podcastJobsTable).where(eq(podcastJobsTable.userId, userId));
    await tx.update(jobsTable).set({
      audioObjectPath: null,
      referenceImagePath: null,
      videoId: null,
      manifest: null,
    }).where(eq(jobsTable.userId, userId));
    await tx.update(editorProjectsTable).set({
      manifest: {},
      lastVideoId: null,
    }).where(eq(editorProjectsTable.userId, userId));
    await tx.update(usersTable).set({ mediaRetentionDeletedAt: now })
      .where(eq(usersTable.id, userId));
    logger.info({ userId, deletedObjectCount: paths.size }, "Expired member media permanently deleted");
  });
}

export async function runMediaRetentionSweep(now = new Date()): Promise<void> {
  if (running) return;
  running = true;
  try {
    const candidates = await db.select({ id: usersTable.id }).from(usersTable)
      .where(and(
        ne(usersTable.subscriptionStatus, "active"),
        ne(usersTable.subscriptionStatus, "past_due"),
        sql`CASE
          WHEN ${usersTable.subscriptionStatus} = 'trial'
            OR (${usersTable.subscriptionStatus} = 'none' AND ${usersTable.stripeSubscriptionId} IS NULL)
          THEN GREATEST(
            COALESCE(${usersTable.trialEndsAt}, '-infinity'::timestamptz),
            COALESCE(${usersTable.membershipExpiresAt}, '-infinity'::timestamptz)
          )
          ELSE ${usersTable.membershipExpiresAt}
        END < ${now}`,
        sql`NOT EXISTS (
          SELECT 1 FROM ${jobsTable}
          WHERE ${jobsTable.userId} = ${usersTable.id}
            AND ${jobsTable.status} NOT IN ('ready', 'failed')
        )`,
        or(isNull(usersTable.billingCheckoutPendingUntil), lt(usersTable.billingCheckoutPendingUntil, now)),
        isNull(usersTable.mediaRetentionDeletedAt),
      ))
      .limit(BATCH_SIZE);
    for (const candidate of candidates) {
      try {
        await deleteDueUserMedia(candidate.id, now);
      } catch (err) {
        logger.error({ err, userId: candidate.id }, "Media retention cleanup failed; retrying next sweep");
      }
    }
  } finally {
    running = false;
  }
}

export function startMediaRetentionSweep(): () => void {
  if (process.env.NODE_ENV !== "production" && process.env.ENABLE_MEDIA_RETENTION_SWEEP !== "true") {
    logger.info("Media retention sweep disabled outside production");
    return () => {};
  }
  const timer = setInterval(() => {
    void runMediaRetentionSweep().catch((err) =>
      logger.error({ err }, "Media retention sweep failed"),
    );
  }, SWEEP_INTERVAL_MS);
  timer.unref();
  void runMediaRetentionSweep().catch((err) =>
    logger.error({ err }, "Initial media retention sweep failed"),
  );
  return () => clearInterval(timer);
}
