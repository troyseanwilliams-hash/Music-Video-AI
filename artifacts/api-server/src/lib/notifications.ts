import { Resend } from "resend";
import twilio from "twilio";
import { logger } from "./logger.js";

interface JobInfo {
  id: string;
  prompt: string | null;
  style: string | null;
  requestedDuration: string | null;
  userEmail?: string | null;
}

export async function sendApprovalEmail(job: JobInfo): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!apiKey || !adminEmail) return;

  try {
    const resend = new Resend(apiKey);
    const durationLabel =
      job.requestedDuration === "full"
        ? "Full track"
        : job.requestedDuration
          ? `${job.requestedDuration}s`
          : "Unknown";

    await resend.emails.send({
      from: "AI Beat Sync <notifications@aibeatsync.com>",
      to: adminEmail,
      subject: `New job awaiting approval — ${job.id.slice(0, 8)}`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
          <h2 style="margin:0 0 16px">New job awaiting approval</h2>
          <table style="width:100%;border-collapse:collapse">
            <tr><td style="padding:8px 0;color:#666;width:140px">Job ID</td><td style="padding:8px 0;font-family:monospace">${job.id}</td></tr>
            <tr><td style="padding:8px 0;color:#666">User</td><td style="padding:8px 0">${job.userEmail ?? "unknown"}</td></tr>
            <tr><td style="padding:8px 0;color:#666">Style</td><td style="padding:8px 0;text-transform:capitalize">${job.style ?? "—"}</td></tr>
            <tr><td style="padding:8px 0;color:#666">Duration</td><td style="padding:8px 0">${durationLabel}</td></tr>
            <tr><td style="padding:8px 0;color:#666;vertical-align:top">Prompt</td><td style="padding:8px 0">${job.prompt ?? "—"}</td></tr>
          </table>
          <p style="margin:24px 0 0">
            <a href="https://aibeatsync.com/admin" style="background:#7c3aed;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600">
              Review in Admin Panel →
            </a>
          </p>
        </div>
      `,
    });

    logger.info({ jobId: job.id }, "Approval email sent");
  } catch (err) {
    logger.error({ err, jobId: job.id }, "Failed to send approval email");
  }
}

export async function sendApprovalSms(job: JobInfo): Promise<void> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;
  const adminPhone = process.env.ADMIN_PHONE;
  if (!accountSid || !authToken || !fromNumber || !adminPhone) return;

  try {
    const client = twilio(accountSid, authToken);
    const body = `AI Beat Sync: New job awaiting approval\nJob: ${job.id.slice(0, 8)}\nUser: ${job.userEmail ?? "unknown"}\nStyle: ${job.style ?? "—"}\nDuration: ${job.requestedDuration === "full" ? "Full track" : (job.requestedDuration ? job.requestedDuration + "s" : "—")}\nReview: aibeatsync.com/admin`;

    await client.messages.create({
      body,
      from: fromNumber,
      to: adminPhone,
    });

    logger.info({ jobId: job.id }, "Approval SMS sent");
  } catch (err) {
    logger.error({ err, jobId: job.id }, "Failed to send approval SMS");
  }
}

export function notifyJobPendingApproval(job: JobInfo): void {
  Promise.all([sendApprovalEmail(job), sendApprovalSms(job)]).catch((err) => {
    logger.error({ err, jobId: job.id }, "Unexpected error in approval notifications");
  });
}
