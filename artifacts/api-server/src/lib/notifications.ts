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

// Notify admin(s) when a new user signs up. Sent to NOTIFY_EMAIL if set,
// otherwise ADMIN_EMAIL. Never throws — best-effort.
export function notifyNewUser(user: { id: string; email?: string | null; name?: string | null }): void {
  const adminEmail = process.env.NOTIFY_EMAIL || process.env.ADMIN_EMAIL;
  const resend = getResend();
  if (resend && adminEmail) {
    resend.emails
      .send({
        from: "AIBeatSync <notifications@aibeatsync.com>",
        to: adminEmail,
        subject: `🎉 New signup — ${user.email ?? user.id.slice(0, 8)}`,
        html: `
          <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
            <h2 style="margin:0 0 16px">New user signed up</h2>
            <table style="width:100%;border-collapse:collapse">
              <tr><td style="padding:8px 0;color:#666;width:120px">Email</td><td style="padding:8px 0;font-weight:600">${user.email ?? "—"}</td></tr>
              ${user.name ? `<tr><td style="padding:8px 0;color:#666">Name</td><td style="padding:8px 0">${user.name}</td></tr>` : ""}
              <tr><td style="padding:8px 0;color:#666">User ID</td><td style="padding:8px 0;font-family:monospace">${user.id}</td></tr>
              <tr><td style="padding:8px 0;color:#666">When</td><td style="padding:8px 0">${new Date().toLocaleString()}</td></tr>
            </table>
          </div>
        `,
      })
      .then(() => logger.info({ userId: user.id }, "New-user email sent"))
      .catch((err: unknown) => logger.error({ err, userId: user.id }, "Failed to send new-user email"));
  }

  const sms = getSmsClient();
  const fromNumber = process.env.TWILIO_FROM_NUMBER;
  const adminPhone = process.env.ADMIN_PHONE;
  if (sms && fromNumber && adminPhone) {
    sms.messages
      .create({ body: `AiBeatSync: New signup — ${user.email ?? user.id.slice(0, 8)}`, from: fromNumber, to: adminPhone })
      .then(() => logger.info({ userId: user.id }, "New-user SMS sent"))
      .catch((err: unknown) => logger.error({ err, userId: user.id }, "Failed to send new-user SMS"));
  }
}

// Notify admin(s) when money is spent (subscription payment or credit top-up).
export function notifyPayment(p: {
  email?: string | null;
  kind: "subscription" | "topup";
  amountUsd?: number | null;
  detail?: string | null;
}): void {
  const adminEmail = process.env.NOTIFY_EMAIL || process.env.ADMIN_EMAIL;
  const amount = p.amountUsd != null ? `$${p.amountUsd.toFixed(2)}` : "—";
  const kindLabel = p.kind === "subscription" ? "Subscription payment" : "Credit top-up";
  const resend = getResend();
  if (resend && adminEmail) {
    resend.emails
      .send({
        from: "AIBeatSync <notifications@aibeatsync.com>",
        to: adminEmail,
        subject: `💰 ${amount} — ${kindLabel} from ${p.email ?? "a customer"}`,
        html: `
          <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
            <h2 style="margin:0 0 16px">${kindLabel} received</h2>
            <table style="width:100%;border-collapse:collapse">
              <tr><td style="padding:8px 0;color:#666;width:120px">Amount</td><td style="padding:8px 0;font-weight:700;font-size:18px">${amount}</td></tr>
              <tr><td style="padding:8px 0;color:#666">Customer</td><td style="padding:8px 0">${p.email ?? "—"}</td></tr>
              <tr><td style="padding:8px 0;color:#666">Type</td><td style="padding:8px 0">${kindLabel}</td></tr>
              ${p.detail ? `<tr><td style="padding:8px 0;color:#666">Detail</td><td style="padding:8px 0">${p.detail}</td></tr>` : ""}
              <tr><td style="padding:8px 0;color:#666">When</td><td style="padding:8px 0">${new Date().toLocaleString()}</td></tr>
            </table>
          </div>
        `,
      })
      .then(() => logger.info({ email: p.email, amount }, "Payment email sent"))
      .catch((err: unknown) => logger.error({ err }, "Failed to send payment email"));
  }

  const sms = getSmsClient();
  const fromNumber = process.env.TWILIO_FROM_NUMBER;
  const adminPhone = process.env.ADMIN_PHONE;
  if (sms && fromNumber && adminPhone) {
    sms.messages
      .create({ body: `AiBeatSync: ${amount} ${kindLabel} from ${p.email ?? "customer"}`, from: fromNumber, to: adminPhone })
      .then(() => logger.info({ email: p.email }, "Payment SMS sent"))
      .catch((err: unknown) => logger.error({ err }, "Failed to send payment SMS"));
  }
}

// Notify admin(s) that someone requested a not-yet-live feature (e.g. vocals).
export function notifyFeatureRequest(p: { email?: string | null; feature: string }): void {
  const adminEmail = process.env.NOTIFY_EMAIL || process.env.ADMIN_EMAIL;
  const resend = getResend();
  if (resend && adminEmail) {
    resend.emails
      .send({
        from: "AIBeatSync <notifications@aibeatsync.com>",
        to: adminEmail,
        subject: `👋 Feature request: ${p.feature} — ${p.email ?? "a user"}`,
        html: `
          <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
            <h2 style="margin:0 0 16px">Someone wants: ${p.feature}</h2>
            <table style="width:100%;border-collapse:collapse">
              <tr><td style="padding:8px 0;color:#666;width:120px">Feature</td><td style="padding:8px 0;font-weight:600">${p.feature}</td></tr>
              <tr><td style="padding:8px 0;color:#666">From</td><td style="padding:8px 0">${p.email ?? "—"}</td></tr>
              <tr><td style="padding:8px 0;color:#666">When</td><td style="padding:8px 0">${new Date().toLocaleString()}</td></tr>
            </table>
          </div>
        `,
      })
      .then(() => logger.info({ feature: p.feature }, "Feature-request email sent"))
      .catch((err: unknown) => logger.error({ err }, "Failed to send feature-request email"));
  }
}
