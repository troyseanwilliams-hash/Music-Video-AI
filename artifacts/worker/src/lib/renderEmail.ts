// Render-finished user notifications (roadmap #6).
//
// Emails the job owner when a render completes or permanently fails. Uses the
// Resend REST API via fetch (no SDK dependency, so this file works unchanged
// in both artifacts/api-server and artifacts/worker — keep the copies
// identical). Respects the user's notify_on_complete preference. Fire-and-
// forget: email failures never affect job processing.

import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger.js";

const APP_URL = process.env.APP_URL ?? "https://aibeatsync.com";
const FROM = "AIBeatSync <notifications@aibeatsync.com>";

async function sendViaResend(to: string, subject: string, html: string): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    logger.warn("RESEND_API_KEY not set — render email skipped");
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to, subject, html }),
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
    if (!user?.email || user.notifyOnComplete === false) return;

    const title = job.prompt?.slice(0, 80) || "Your video";
    await sendViaResend(
      user.email,
      "Your video is ready 🎬",
      `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
        <h2 style="margin:0 0 12px">Your video is ready</h2>
        <p style="color:#444">"${title}" just finished rendering.</p>
        <p style="margin:24px 0">
          <a href="${APP_URL}/jobs/${job.id}" style="background:#7c3aed;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600">
            Watch it now →
          </a>
        </p>
        <p style="color:#888;font-size:12px">You can turn these emails off from your dashboard.</p>
      </div>
      `,
    );
    logger.info({ jobId: job.id }, "Render-ready email sent");
  } catch (err) {
    logger.error({ err, jobId: job.id }, "Failed to send render-ready email (non-fatal)");
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
      `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
        <h2 style="margin:0 0 12px">A video render failed — credits were NOT refunded</h2>
        <p style="color:#444">This job needs your attention. Try recovering it (re-run failed clips / finalize from partial clips) before deciding whether to refund the user manually.</p>
        <table style="width:100%;border-collapse:collapse;margin-top:8px">
          <tr><td style="padding:6px 0;color:#666;width:120px">Job ID</td><td style="padding:6px 0;font-family:monospace">${job.id}</td></tr>
          <tr><td style="padding:6px 0;color:#666">User</td><td style="padding:6px 0">${userEmail ?? "unknown"}</td></tr>
          <tr><td style="padding:6px 0;color:#666;vertical-align:top">Prompt</td><td style="padding:6px 0">${title}</td></tr>
          <tr><td style="padding:6px 0;color:#666;vertical-align:top">Reason</td><td style="padding:6px 0;color:#b91c1c">${reason.slice(0, 300)}</td></tr>
        </table>
        <p style="margin:24px 0">
          <a href="${APP_URL}/admin" style="background:#7c3aed;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600">
            Open Admin — recover this job →
          </a>
        </p>
      </div>
      `,
    );
    logger.info({ jobId: job.id }, "Admin render-failure alert sent");
  } catch (err) {
    logger.error({ err, jobId: job.id }, "Failed to send admin render-failure alert (non-fatal)");
  }
}

/** Emails the job owner that their render permanently failed. Never throws. */
export async function notifyRenderFailed(job: RenderEmailJob, reason: string): Promise<void> {
  try {
    const [user] = await db
      .select({ email: usersTable.email, notifyOnComplete: usersTable.notifyOnComplete })
      .from(usersTable)
      .where(eq(usersTable.id, job.userId))
      .limit(1);
    if (!user?.email || user.notifyOnComplete === false) return;

    const title = job.prompt?.slice(0, 80) || "Your video";
    await sendViaResend(
      user.email,
      "Your render didn't finish",
      `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
        <h2 style="margin:0 0 12px">Your render didn't finish</h2>
        <p style="color:#444">"${title}" failed: ${reason.slice(0, 200)}</p>
        <p style="margin:24px 0">
          <a href="${APP_URL}/jobs/${job.id}" style="background:#7c3aed;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600">
            View details & retry →
          </a>
        </p>
        <p style="color:#888;font-size:12px">You can turn these emails off from your dashboard.</p>
      </div>
      `,
    );
    logger.info({ jobId: job.id }, "Render-failed email sent");
  } catch (err) {
    logger.error({ err, jobId: job.id }, "Failed to send render-failed email (non-fatal)");
  }
}
