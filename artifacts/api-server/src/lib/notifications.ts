import { Resend } from "resend";
import twilio from "twilio";
import { logger } from "./logger.js";
import { adminEmailHtml, detailRow, escapeHtml, unsubscribeUrl, unsubscribeHeaders } from "./emailTemplates.js";
import { WELCOME_CREDITS, WELCOME_OFFER_COPY } from "./welcomeOffer.js";

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
        html: adminEmailHtml({
          heading: "New job awaiting approval",
          rows:
            detailRow("Job ID", escapeHtml(job.id), { mono: true }) +
            detailRow("User", escapeHtml(job.userEmail ?? "unknown")) +
            detailRow("Style", escapeHtml(job.style ?? "—")) +
            detailRow("Duration", escapeHtml(durationLabel)) +
            detailRow("Prompt", escapeHtml(job.prompt ?? "—")),
          ctaHref: "https://aibeatsync.com/admin",
          ctaLabel: "Review in Admin Panel →",
        }),
      })
      .then(() => logger.info({ jobId: job.id }, "Approval email sent"))
      .catch((err: unknown) => logger.error({ err, jobId: job.id }, "Failed to send approval email"));
  }

  const sms = getSmsClient();
  const fromNumber = process.env.TWILIO_FROM_NUMBER;
  const adminPhone = process.env.ADMIN_PHONE;
  if (sms && fromNumber && adminPhone) {
    const body =
      `AIBeatSync: New job needs approval\n` +
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
        html: adminEmailHtml({
          heading: "New support ticket",
          rows:
            detailRow("From", escapeHtml(ticket.userEmail ?? "unknown")) +
            detailRow("Category", escapeHtml(ticket.category)) +
            detailRow("Subject", escapeHtml(ticket.subject), { strong: true }) +
            detailRow("Message", `<span style="white-space:pre-wrap">${escapeHtml(ticket.message)}</span>`),
          ctaHref: "https://aibeatsync.com/admin",
          ctaLabel: "View in Admin Panel →",
        }),
      })
      .then(() => logger.info({ ticketId: ticket.id }, "Support ticket email sent"))
      .catch((err: unknown) => logger.error({ err, ticketId: ticket.id }, "Failed to send support ticket email"));
  }

  const sms = getSmsClient();
  const fromNumber = process.env.TWILIO_FROM_NUMBER;
  const adminPhone = process.env.ADMIN_PHONE;
  if (sms && fromNumber && adminPhone) {
    const body =
      `AIBeatSync: New support ticket\n` +
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
        html: adminEmailHtml({
          heading: "New user signed up 🎉",
          rows:
            detailRow("Email", escapeHtml(user.email ?? "—"), { strong: true }) +
            (user.name ? detailRow("Name", escapeHtml(user.name)) : "") +
            detailRow("User ID", escapeHtml(user.id), { mono: true }) +
            detailRow("When", new Date().toLocaleString()),
        }),
      })
      .then(() => logger.info({ userId: user.id }, "New-user email sent"))
      .catch((err: unknown) => logger.error({ err, userId: user.id }, "Failed to send new-user email"));
  }

  const sms = getSmsClient();
  const fromNumber = process.env.TWILIO_FROM_NUMBER;
  const adminPhone = process.env.ADMIN_PHONE;
  if (sms && fromNumber && adminPhone) {
    sms.messages
      .create({ body: `AIBeatSync: New signup — ${user.email ?? user.id.slice(0, 8)}`, from: fromNumber, to: adminPhone })
      .then(() => logger.info({ userId: user.id }, "New-user SMS sent"))
      .catch((err: unknown) => logger.error({ err, userId: user.id }, "Failed to send new-user SMS"));
  }
}

// Welcome email to the new user themselves — features highlight plus a light
// AIPodSync (sister product) mention. Best-effort, never blocks signup.
export function sendWelcomeEmail(user: { id: string; email?: string | null; name?: string | null }): void {
  const resend = getResend();
  if (!resend || !user.email) return;
  const firstName = escapeHtml((user.name ?? "").trim().split(/\s+/)[0] || "") || null;
  const appUrl = process.env.APP_URL ?? "https://aibeatsync.com";
  let unsub: string;
  let unsubHeaders: Record<string, string> | undefined;
  try {
    unsub = unsubscribeUrl(appUrl, user.id);
    unsubHeaders = unsubscribeHeaders(unsub);
  } catch {
    unsub = `${appUrl}/dashboard`; // SESSION_SECRET missing — degrade gracefully, never block signup
  }
  const feature = (title: string, desc: string) => `
    <tr>
      <td style="padding:10px 0;vertical-align:top;width:8px">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#a855f7;margin-top:6px"></span>
      </td>
      <td style="padding:10px 0 10px 12px">
        <span style="font-weight:600;color:#111">${title}</span>
        <span style="color:#555"> — ${desc}</span>
      </td>
    </tr>`;
  resend.emails
    .send({
      from: "AIBeatSync <notifications@aibeatsync.com>",
      to: user.email,
      subject: `Welcome to AIBeatSync 🎬 — ${WELCOME_CREDITS} credits to get started`,
      ...(unsubHeaders ? { headers: unsubHeaders } : {}),
      html: `
        <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;padding:32px 24px;color:#111">
          <div style="text-align:center;margin-bottom:24px">
            <span style="display:inline-block;background:linear-gradient(90deg,#7c3aed,#2563eb);color:#fff;font-weight:700;font-size:20px;padding:10px 22px;border-radius:12px">AIBeatSync</span>
          </div>
          <h1 style="font-size:22px;margin:0 0 12px">Welcome${firstName ? `, ${firstName}` : ""}! 👋</h1>
          <p style="font-size:15px;line-height:1.6;color:#333;margin:0 0 20px">
            You're in. ${WELCOME_OFFER_COPY} Use them to make AI images, music and video.
            Your credits don't expire; other included Editor features remain available during your introductory access window.
          </p>
          <p style="font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#888;margin:0 0 4px">What you can do</p>
          <table style="width:100%;border-collapse:collapse;font-size:14px;line-height:1.5">
            ${feature("Generate", "describe a vibe, pick a style, upload or create a song — get a beat-synced music video.")}
            ${feature("Lyric Sync", "karaoke-style captions synced word-by-word to the vocal, burned right onto your video.")}
            ${feature("Remix Lab & Prompt Studio", "reimagine finished videos and let AI polish your prompts and lyrics.")}
            ${feature("Release Kit", "one click turns a finished video into TikTok/Shorts teasers, a Spotify Canvas loop, and more.")}
          </table>
          <div style="text-align:center;margin:28px 0">
            <a href="${appUrl}/generate" style="display:inline-block;background:linear-gradient(90deg,#7c3aed,#2563eb);color:#fff;font-weight:600;font-size:15px;text-decoration:none;padding:14px 32px;border-radius:10px">Create your first video</a>
          </div>
          <p style="font-size:13px;line-height:1.6;color:#666;border-top:1px solid #eee;padding-top:16px;margin:0 0 8px">
            P.S. — AIBeatSync has a sister studio: <a href="https://aipodsync.com" style="color:#7c3aed;text-decoration:none;font-weight:600">AIPodSync</a>,
            which turns a written script into a professional, narrated podcast. Same idea, different craft.
          </p>
          <p style="font-size:12px;color:#999;margin:16px 0 0">
            Questions? Just reply to this email. — The AIBeatSync team ·
            <a href="${unsub}" style="color:#7c3aed;text-decoration:none">Unsubscribe from notifications</a>
          </p>
        </div>
      `,
    })
    .then(() => logger.info({ userId: user.id }, "Welcome email sent"))
    .catch((err: unknown) => logger.error({ err, userId: user.id }, "Failed to send welcome email"));
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
        html: adminEmailHtml({
          heading: `${kindLabel} received 💰`,
          rows:
            detailRow("Amount", `<span style="font-weight:700;font-size:18px">${escapeHtml(amount)}</span>`) +
            detailRow("Customer", escapeHtml(p.email ?? "—")) +
            detailRow("Type", kindLabel) +
            (p.detail ? detailRow("Detail", escapeHtml(p.detail)) : "") +
            detailRow("When", new Date().toLocaleString()),
        }),
      })
      .then(() => logger.info({ email: p.email, amount }, "Payment email sent"))
      .catch((err: unknown) => logger.error({ err }, "Failed to send payment email"));
  }

  const sms = getSmsClient();
  const fromNumber = process.env.TWILIO_FROM_NUMBER;
  const adminPhone = process.env.ADMIN_PHONE;
  if (sms && fromNumber && adminPhone) {
    sms.messages
      .create({ body: `AIBeatSync: ${amount} ${kindLabel} from ${p.email ?? "customer"}`, from: fromNumber, to: adminPhone })
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
        html: adminEmailHtml({
          heading: `Someone wants: ${escapeHtml(p.feature)}`,
          rows:
            detailRow("Feature", escapeHtml(p.feature), { strong: true }) +
            detailRow("From", escapeHtml(p.email ?? "—")) +
            detailRow("When", new Date().toLocaleString()),
        }),
      })
      .then(() => logger.info({ feature: p.feature }, "Feature-request email sent"))
      .catch((err: unknown) => logger.error({ err }, "Failed to send feature-request email"));
  }
}
