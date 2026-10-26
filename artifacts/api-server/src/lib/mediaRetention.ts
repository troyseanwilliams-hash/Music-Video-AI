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

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
const BATCH_SIZE = 10;
const storage = new ObjectStorageService();
let running = false;

export function mediaObjectPaths(value: unknown, paths = new Set<string>()): Set<string> {
  if (typeof value === "string") {
    const matches = value.match(/\/objects\/[A-Za-z0-9._/-]+/g) ?? [];
    for (const path of matches) paths.add(path.replace(/[),.;]+$/, ""));
  } else if (Array.isArray(value)) {
    for (const item of value) mediaObjectPaths(item, paths);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) mediaObjectPaths(item, paths);
  }
  return paths;
}

function expirationOf(user: {
  subscriptionStatus: string;
  trialEndsAt: Date | null;
  membershipExpiresAt: Date | null;
}): Date | null {
  const expirations = [
    user.trialEndsAt,
    user.membershipExpiresAt,
  ].filter((date): date is Date => date instanceof Date);
  if (user.subscriptionStatus === "active" || user.subscriptionStatus === "past_due") return null;
  if (!expirations.length) return null;
  return new Date(Math.max(...expirations.map((date) => date.getTime())));
}

async function deleteDueUserMedia(userId: string, now: Date): Promise<void> {
  await db.transaction(async (tx) => {
    const [user] = await tx.select({
      id: usersTable.id,
      email: usersTable.email,
      subscriptionStatus: usersTable.subscriptionStatus,
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
    const expiration = expirationOf(user);
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
      // Existing accounts get a full 30-day warning period from first
      // discovery; newly expired accounts are found on the hourly sweep.
      await tx.update(usersTable).set({
        mediaRetentionStartedAt: now,
        mediaRetentionNoticeSentAt: null,
      }).where(eq(usersTable.id, userId));
    }
    const retentionStartedAt = user.mediaRetentionStartedAt ?? now;
    if (!user.mediaRetentionNoticeSentAt) {
      const sent = await sendMediaRetentionNotice({
        id: userId,
        email: user.email,
        deleteAt: new Date(retentionStartedAt.getTime() + RETENTION_MS),
      });
      if (sent) {
        await tx.update(usersTable).set({ mediaRetentionNoticeSentAt: now })
          .where(eq(usersTable.id, userId));
      }
    }

    if (retentionStartedAt.getTime() + RETENTION_MS > now.getTime()) {
      if (!user.mediaRetentionStartedAt) {
        logger.info({ userId, deleteAt: new Date(retentionStartedAt.getTime() + RETENTION_MS) }, "Media retention period started");
      }
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
        or(
          lt(usersTable.trialEndsAt, now),
          lt(usersTable.membershipExpiresAt, now),
        ),
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
