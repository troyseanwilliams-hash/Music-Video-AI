// Render-finished user notifications (roadmap #6).
//
// Emails the job owner only when a render completes. Permanent failures alert
// ADMIN_EMAIL instead. Uses the Resend REST API via fetch (no SDK dependency,
// so this file works unchanged in both artifacts/api-server and
// artifacts/worker — keep the copies identical). Respects the user's
// notify_on_complete preference. Fire-and-forget: email failures never affect
// job processing.

import { db, jobsTable, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "./logger.js";
import {
  renderReadyEmailHtml,
  adminEmailHtml,
  detailRow,
  escapeHtml,
  unsubscribeUrl,
  unsubscribeHeaders,
} from "./emailTemplates.js";

export function normalizeAppUrl(appUrl = process.env.APP_URL): string {
  const value = (appUrl?.trim() || "https://aibeatsync.com").replace(/\/+$/, "");
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

const APP_URL = normalizeAppUrl();
const FROM = "AIBeatSync <notifications@aibeatsync.com>";

async function sendViaResend(to: string, subject: string, html: string, extraHeaders?: Record<string, string>): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    logger.warn("RESEND_API_KEY not set — render email skipped");
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to, subject, html, ...(extraHeaders ? { headers: extraHeaders } : {}) }),
  });
  if (!res.ok) {
    throw new Error(`Resend API ${res.status}: ${await res.text().catch(() => "")}`);
  }
}

export interface RenderEmailJob {
  id: string;
  userId: string;
  prompt?: string | null;
}

/** Emails the job owner that their video is ready. Never throws. */
export async function notifyRenderReady(job: RenderEmailJob): Promise<void> {
  try {
    const [user] = await db
      .select({ email: usersTable.email, notifyOnComplete: usersTable.notifyOnComplete })
      .from(usersTable)
      .where(eq(usersTable.id, job.userId))
      .limit(1);
    if (user?.email && user.notifyOnComplete !== false) {
      const title = job.prompt?.slice(0, 80) || "Your video";
      const unsub = unsubscribeUrl(APP_URL, job.userId);
      await sendViaResend(
        user.email,
        "Your video is ready 🎬",
        renderReadyEmailHtml({
          title,
          jobUrl: `${APP_URL}/api/email/video/${encodeURIComponent(job.id)}`,
          unsubscribeUrl: unsub,
        }),
        unsubscribeHeaders(unsub),
      );
      logger.info({ jobId: job.id }, "Render-ready email sent");
    }
  } catch (err) {
    logger.error({ err, jobId: job.id }, "Failed to send render-ready email (non-fatal)");
  }
  await notifyRequestedAdminRenderReady(job);
}

export async function notifyRequestedAdminRenderReady(job: RenderEmailJob): Promise<void> {
  try {
    const [row] = await db
      .select({ manifest: jobsTable.manifest })
      .from(jobsTable)
      .where(eq(jobsTable.id, job.id))
      .limit(1);
    const manifest =
      row?.manifest && typeof row.manifest === "object"
        ? (row.manifest as Record<string, unknown>)
        : {};
    if (manifest.notifyAdminOnComplete !== true || manifest.adminCompletionNotifiedAt) return;
    const adminEmail = process.env.ADMIN_EMAIL;
    if (!adminEmail) {
      logger.warn({ jobId: job.id }, "ADMIN_EMAIL not set — requested completion alert skipped");
      return;
    }
    await sendViaResend(
      adminEmail,
      "User video job finished",
      adminEmailHtml({
        heading: "User video job finished",
        intro: "The requested user video has completed successfully.",
        rows: [
          detailRow("Job ID", escapeHtml(job.id)),
          detailRow("Title", escapeHtml(job.prompt?.slice(0, 120) || "Untitled video")),
        ].join(""),
        ctaHref: `${APP_URL}/api/email/video/${encodeURIComponent(job.id)}`,
        ctaLabel: "View completed video",
      }),
    );
    await db.execute(sql`
      UPDATE jobs
      SET manifest = jsonb_set(
        jsonb_set(
          COALESCE(manifest, '{}'::jsonb),
          '{notifyAdminOnComplete}',
          'false'::jsonb
        ),
        '{adminCompletionNotifiedAt}',
        to_jsonb(NOW()::text)
      ),
      updated_at = NOW()
      WHERE id = ${job.id}
        AND COALESCE((manifest->>'notifyAdminOnComplete')::boolean, false) = true
        AND manifest->>'adminCompletionNotifiedAt' IS NULL
    `);
    logger.info({ jobId: job.id }, "Requested admin completion email sent");
  } catch (err) {
    logger.error({ err, jobId: job.id }, "Failed to send requested admin completion email (non-fatal)");
  }
}

/**
 * Alerts the admin that a video render failed so they can attempt a fix/recovery
 * (re-run failed clips for free, finalize from partial clips, or manually
 * refund). Used INSTEAD of auto-refunding + emailing the user on fixable
 * (technical/provider) failures — the goal is to save the sale and recover the
 * job rather than silently hand the credits back. Never throws.
 */
export async function notifyAdminRenderFailed(job: RenderEmailJob, reason: string): Promise<void> {
  try {
    const adminEmail = process.env.ADMIN_EMAIL;
    if (!adminEmail) {
      logger.warn({ jobId: job.id }, "ADMIN_EMAIL not set — admin render-failure alert skipped");
      return;
    }
    // Pull the owner's email for context (best-effort).
    let userEmail: string | null = null;
    try {
      const [u] = await db
        .select({ email: usersTable.email })
        .from(usersTable)
        .where(eq(usersTable.id, job.userId))
        .limit(1);
      userEmail = u?.email ?? null;
    } catch { /* non-fatal */ }

    const title = job.prompt?.slice(0, 100) || "(no prompt)";
    await sendViaResend(
      adminEmail,
      `⚠️ Render failed — needs a fix (${job.id.slice(0, 8)})`,
      adminEmailHtml({
        heading: "A render failed",
        intro:
          "This job needs your attention. Review its saved progress, recovery state, and credit settlement before taking action.",
        rows:
          detailRow("Job ID", escapeHtml(job.id), { mono: true }) +
          detailRow("User", escapeHtml(userEmail ?? "unknown")) +
          detailRow("Prompt", escapeHtml(title)) +
          detailRow("Reason", escapeHtml(reason.slice(0, 300)), { color: "#b91c1c" }),
        ctaHref: `${APP_URL}/admin`,
        ctaLabel: "Open Admin — recover this job →",
      }),
    );
    logger.info({ jobId: job.id }, "Admin render-failure alert sent");
  } catch (err) {
    logger.error({ err, jobId: job.id }, "Failed to send admin render-failure alert (non-fatal)");
  }
}

export function shouldSuppressCustomerFailureEmail(_reason: string): boolean {
  return true;
}

/** Legacy failure entry point. Failures alert admins only; customers get completion emails. */
export async function notifyRenderFailed(job: RenderEmailJob, reason: string): Promise<void> {
  logger.info({ jobId: job.id }, "Customer render-failure email suppressed by policy");
  await notifyAdminRenderFailed(job, reason);
}
