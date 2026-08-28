// Scheduled cleanup of soft-deleted videos. A user's deleted videos stay on the
// site (hidden from them, visible to admins) until they age past the retention
// window, at which point this sweep permanently removes their stored files and
// database rows. Admins can also purge sooner via the admin panel.
import { db } from "@workspace/db";
import { videosTable } from "@workspace/db";
import { and, eq, isNotNull, lt } from "drizzle-orm";
import { ObjectStorageService } from "./objectStorage.js";
import { logger } from "./logger.js";

const storageService = new ObjectStorageService();

// Days a soft-deleted video is retained before automatic permanent deletion.
const RETENTION_DAYS = Number(process.env.DELETED_VIDEO_RETENTION_DAYS ?? 30);
const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000; // once a day
const BATCH_LIMIT = 200; // cap work per sweep so it never runs long

async function purgeExpiredDeletedVideos(): Promise<void> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000);
  const expired = await db
    .select()
    .from(videosTable)
    .where(and(isNotNull(videosTable.deletedAt), lt(videosTable.deletedAt, cutoff)))
    .limit(BATCH_LIMIT);

  if (expired.length === 0) return;

  let purged = 0;
  for (const video of expired) {
    try {
      await storageService.deleteVideoAssets(video);
      await db.delete(videosTable).where(eq(videosTable.id, video.id));
      purged++;
    } catch (err) {
      logger.error({ err, videoId: video.id }, "Auto-purge failed for video");
    }
  }
  logger.info({ purged, retentionDays: RETENTION_DAYS }, "Auto-purged expired deleted videos");
}

// Start the recurring sweep: once shortly after boot, then daily.
export function startDeletedVideoPurgeSweep(): () => void {
  const run = () =>
    purgeExpiredDeletedVideos().catch((err) => logger.error({ err }, "Purge sweep error"));
  const initialTimer = setTimeout(run, 60_000);
  const intervalTimer = setInterval(run, SWEEP_INTERVAL_MS);
  initialTimer.unref?.();
  intervalTimer.unref?.();
  logger.info({ retentionDays: RETENTION_DAYS }, "Deleted-video purge sweep scheduled");
  return () => {
    clearTimeout(initialTimer);
    clearInterval(intervalTimer);
  };
}
