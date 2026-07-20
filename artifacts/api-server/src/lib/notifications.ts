import { Resend } from "resend";
import twilio from "twilio";
import { logger } from "./logger.js";

function getSmsClient(): ReturnType<typeof twilio> | null {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env;
  if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) return twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  return null;
}

function getResend(): Resend | null {
  return process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
}

interface JobInfo {
  id: string;
  prompt: string | null;
  style: string | null;
  requestedDuration: string | null;
  userEmail?: string | null;
}

export function notifyJobPendingApproval(job: JobInfo): void {
  const durationLabel =
    job.requestedDuration === "full"
      ? "Full track"
      : job.requestedDuration
        ? `${job.requestedDuration}s`
        : "—";

  const adminEmail = process.env.ADMIN_EMAIL;
  const resend = getResend();
  if (resend && adminEmail) {
    resend.emails
      .send({
        from: "AIBeatSync <notifications@aibeatsync.com>",
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
      })
      .then(() => logger.info({ jobId: job.id }, "Approval email sent"))
      .catch((err: unknown) => logger.error({ err, jobId: job.id }, "Failed to send approval email"));
  }

  const sms = getSmsClient();
  const fromNumber = process.env.TWILIO_FROM_NUMBER;
  const adminPhone = process.env.ADMIN_PHONE;
  if (sms && fromNumber && adminPhone) {
    const body =
      `AiBeatSync: New job needs approval\n` +
      `ID: ${job.id.slice(0, 8)}\n` +
      `User: ${job.userEmail ?? "unknown"}\n` +
      `Style: ${job.style ?? "—"} · ${durationLabel}\n` +
      `https://aibeatsync.com/admin`;
    sms.messages
      .create({ body, from: fromNumber, to: adminPhone })
      .then(() => logger.info({ jobId: job.id }, "Approval SMS sent"))
      .catch((err: unknown) => logger.error({ err, jobId: job.id }, "Failed to send approval SMS"));
  }
}

interface SupportTicketInfo {
  id: string;
  subject: string;
  message: string;
  category: string;
  userEmail?: string | null;
}

export function notifyNewSupportTicket(ticket: SupportTicketInfo): void {
  const adminEmail = process.env.ADMIN_EMAIL;
  const resend = getResend();
  if (resend && adminEmail) {
    resend.emails
      .send({
        from: "AIBeatSync <notifications@aibeatsync.com>",
        to: adminEmail,
        subject: `[Support] ${ticket.subject}`,
        html: `
          <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
            <h2 style="margin:0 0 16px">New support ticket</h2>
            <table style="width:100%;border-collapse:collapse">
              <tr><td style="padding:8px 0;color:#666;width:120px">From</td><td style="padding:8px 0">${ticket.userEmail ?? "unknown"}</td></tr>
              <tr><td style="padding:8px 0;color:#666">Category</td><td style="padding:8px 0;text-transform:capitalize">${ticket.category}</td></tr>
              <tr><td style="padding:8px 0;color:#666">Subject</td><td style="padding:8px 0;font-weight:600">${ticket.subject}</td></tr>
              <tr><td style="padding:8px 0;color:#666;vertical-align:top">Message</td><td style="padding:8px 0;white-space:pre-wrap">${ticket.message}</td></tr>
            </table>
            <p style="margin:24px 0 0">
              <a href="https://aibeatsync.com/admin" style="background:#7c3aed;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600">
                View in Admin Panel →
              </a>
            </p>
          </div>
        `,
      })
      .then(() => logger.info({ ticketId: ticket.id }, "Support ticket email sent"))
      .catch((err: unknown) => logger.error({ err, ticketId: ticket.id }, "Failed to send support ticket email"));
  }

  const sms = getSmsClient();
  const fromNumber = process.env.TWILIO_FROM_NUMBER;
  const adminPhone = process.env.ADMIN_PHONE;
  if (sms && fromNumber && adminPhone) {
    const body =
      `AiBeatSync: New support ticket\n` +
      `From: ${ticket.userEmail ?? "unknown"}\n` +
      `[${ticket.category}] ${ticket.subject}\n` +
      `https://aibeatsync.com/admin`;
    sms.messages
      .create({ body, from: fromNumber, to: adminPhone })
      .then(() => logger.info({ ticketId: ticket.id }, "Support ticket SMS sent"))
      .catch((err: unknown) => logger.error({ err, ticketId: ticket.id }, "Failed to send support ticket SMS"));
  }
}
