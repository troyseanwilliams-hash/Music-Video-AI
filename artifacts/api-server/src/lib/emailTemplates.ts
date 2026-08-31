// Branded HTML email templates — the "Welcome email" design language applied
// to every mail the app sends: centered gradient AIBeatSync badge, clean
// typography, gradient CTA button, light footer. Pure functions, no DB or
// side effects, so they're easy to preview/test-send.
//
// Keep this file identical in artifacts/api-server and artifacts/worker.

import crypto from "node:crypto";

const GRADIENT = "linear-gradient(90deg,#7c3aed,#2563eb)";

// ---------------------------------------------------------------------------
// One-click unsubscribe tokens (HMAC of the user id — no DB table needed).
// Security emails (password reset) must never use these links.
// ---------------------------------------------------------------------------

export function unsubscribeToken(userId: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required to build unsubscribe tokens");
  return crypto.createHmac("sha256", secret).update(`unsub:${userId}`).digest("hex").slice(0, 32);
}

export function verifyUnsubscribeToken(userId: string, token: string): boolean {
  if (!process.env.SESSION_SECRET) return false;
  const expected = unsubscribeToken(userId);
  if (token.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}

/** No-login unsubscribe URL for notification emails. */
export function unsubscribeUrl(appUrl: string, userId: string): string {
  return `${appUrl}/api/email/unsubscribe?uid=${encodeURIComponent(userId)}&token=${unsubscribeToken(userId)}`;
}

/** RFC 8058 one-click unsubscribe headers for Resend sends. */
export function unsubscribeHeaders(unsubUrl: string): Record<string, string> {
  return {
    "List-Unsubscribe": `<${unsubUrl}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

/** Escape user-supplied text before interpolating into HTML. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Gradient pill CTA button, centered. */
export function ctaButton(href: string, label: string): string {
  return `
    <div style="text-align:center;margin:28px 0">
      <a href="${href}" style="display:inline-block;background:${GRADIENT};color:#fff;font-weight:600;font-size:15px;text-decoration:none;padding:14px 32px;border-radius:10px">${label}</a>
    </div>`;
}

/** Bulleted feature/next-step row in the Welcome email's dot style. */
export function featureRow(title: string, desc: string): string {
  return `
    <tr>
      <td style="padding:10px 0;vertical-align:top;width:8px">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#a855f7;margin-top:6px"></span>
      </td>
      <td style="padding:10px 0 10px 12px">
        <span style="font-weight:600;color:#111">${title}</span>
        <span style="color:#555"> — ${desc}</span>
      </td>
    </tr>`;
}

/** Key/value row for admin-style detail tables. */
export function detailRow(label: string, value: string, opts?: { mono?: boolean; strong?: boolean; color?: string }): string {
  const style = [
    "padding:8px 0",
    opts?.mono ? "font-family:monospace;font-size:13px" : "",
    opts?.strong ? "font-weight:600" : "",
    opts?.color ? `color:${opts.color}` : "",
  ].filter(Boolean).join(";");
  return `<tr><td style="padding:8px 0;color:#888;width:120px;vertical-align:top;font-size:13px">${label}</td><td style="${style}">${value}</td></tr>`;
}

export function detailTable(rows: string): string {
  return `<table style="width:100%;border-collapse:collapse;font-size:14px;line-height:1.5;margin:4px 0">${rows}</table>`;
}

/**
 * The shared shell: gradient brand badge, content, footer. `footerNote`
 * replaces the default "just reply" line (e.g. unsubscribe hint for
 * notification mails).
 */
export function emailShell(inner: string, opts?: { footerNote?: string }): string {
  const footer = opts?.footerNote ??
    "Questions? Just reply to this email. — The AIBeatSync team";
  return `
    <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;padding:32px 24px;color:#111">
      <div style="text-align:center;margin-bottom:24px">
        <span style="display:inline-block;background:${GRADIENT};color:#fff;font-weight:700;font-size:20px;padding:10px 22px;border-radius:12px">AIBeatSync</span>
      </div>
      ${inner}
      <p style="font-size:12px;color:#999;margin:24px 0 0;border-top:1px solid #eee;padding-top:16px">${footer}</p>
    </div>`;
}

/** Section label in the Welcome email's uppercase style. */
export function sectionLabel(text: string): string {
  return `<p style="font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#888;margin:20px 0 4px">${text}</p>`;
}

export const GENERATE_VIDEO_CAMPAIGN_ID = "aibeatsync-generate-video-full-list-2026-08-30-v2";
export const GENERATE_VIDEO_CAMPAIGN_SUBJECT = "Build the story before you render.";

export function renderGenerateVideoCampaignHtml(p: { appUrl: string; unsubscribeUrl: string }): string {
  const appUrl = escapeHtml(p.appUrl.replace(/\/+$/, ""));
  const imageUrl = `${appUrl}/generate-video-storyboard.jpg`;
  const suiteUrl = "https://aisyncsuite.com";
  const beatSyncUrl = "https://aibeatsync.com";
  const podSyncUrl = "https://aipodsync.com";
  const videoUrl = "https://www.youtube.com/shorts/7bL-ts1M6R8";
  return emailShell(
    `
      <img src="${imageUrl}" alt="Generate Video scene reference storyboard" style="display:block;width:100%;height:auto;border-radius:12px;margin:0 0 24px" />
      <h1 style="font-size:26px;line-height:1.15;margin:0 0 12px">Build the story before you render.</h1>
      <p style="font-size:15px;line-height:1.65;color:#333;margin:0 0 18px">
        Meet the new Generate Video experience: scene-by-scene direction, stronger character continuity,
        and image approvals before animation begins.
      </p>
      <p style="font-size:13px;line-height:1.6;color:#555;margin:0 0 16px">
        Create with <a href="${beatSyncUrl}" style="color:#7c3aed;font-weight:600">AIBeatSync</a>,
        explore the full <a href="${suiteUrl}" style="color:#7c3aed;font-weight:600">AISync Suite</a>,
        and turn scripts into narrated shows with <a href="${podSyncUrl}" style="color:#7c3aed;font-weight:600">AIPodSync</a>.
      </p>
      ${ctaButton(suiteUrl, "Come join AISync Suite →")}
      <p style="font-size:13px;line-height:1.6;color:#666;text-align:center;margin:0 0 12px">
        Shape every scene, keep your characters consistent, and make the final call before your video renders.
      </p>
      <div style="margin-top:28px;padding-top:20px;border-top:1px solid #eee;text-align:center">
        <a href="${videoUrl}" style="color:#7c3aed;font-size:14px;font-weight:600;text-decoration:none">Watch the finished video ↗</a>
      </div>
    `,
    {
      footerNote:
        `<a href="${escapeHtml(p.unsubscribeUrl)}" style="color:#7c3aed;text-decoration:none">Unsubscribe from this announcement</a> — one click, no login needed. Questions? Just reply. — The AIBeatSync team`,
    },
  );
}

export function renderGenerateVideoCampaignText(p: { appUrl: string; unsubscribeUrl: string }): string {
  const appUrl = p.appUrl.replace(/\/+$/, "");
  return `Build the story before you render.

Meet the new Generate Video experience: scene-by-scene direction, stronger character continuity, and image approvals before animation begins.

Create with AIBeatSync: https://aibeatsync.com
Explore the full AISync Suite: https://aisyncsuite.com
Turn scripts into narrated shows with AIPodSync: https://aipodsync.com

Come join AISync Suite: https://aisyncsuite.com

Shape every scene, keep your characters consistent, and make the final call before your video renders.

Watch the finished video: https://www.youtube.com/shorts/7bL-ts1M6R8

Manage email preferences: ${appUrl}/settings
Unsubscribe: ${p.unsubscribeUrl}`;
}

// ---------------------------------------------------------------------------
// User-facing emails
// ---------------------------------------------------------------------------

/** "Your video is ready" — celebration + watch CTA + what-to-do-next. */
export function renderReadyEmailHtml(p: { title: string; jobUrl: string; unsubscribeUrl?: string }): string {
  const title = escapeHtml(p.title);
  const jobUrl = escapeHtml(p.jobUrl);
  return emailShell(
    `
      <h1 style="font-size:22px;margin:0 0 12px">Your video is ready 🎬</h1>
      <p style="font-size:15px;line-height:1.6;color:#333;margin:0 0 8px">
        <strong>“${title}”</strong> just finished rendering — every shot generated and cut to the beat of your track.
      </p>
      ${ctaButton(jobUrl, "▶&nbsp; Watch your video")}
      <p style="font-size:13px;line-height:1.6;color:#666;text-align:center;margin:-12px 0 24px">
        Signed out? We'll ask you to sign in, then open your video.
        <a href="${jobUrl}" style="color:#7c3aed;text-decoration:underline">Open your video</a>
      </p>
      ${sectionLabel("Make the most of it")}
      <table style="width:100%;border-collapse:collapse;font-size:14px;line-height:1.5">
        ${featureRow("Download & post", "grab the MP4 from the video page — it's ready for TikTok, Reels, Shorts, and YouTube.")}
        ${featureRow("Release Kit", "one click turns it into vertical teasers and a Spotify Canvas loop.")}
        ${featureRow("Remix Lab", "not feeling a shot? regenerate just that clip — you only pay for what you redo.")}
      </table>
    `,
    { footerNote: notifyFooter(p.jobUrl, p.unsubscribeUrl) },
  );
}

/** Footer for notification emails: working opt-out link (CAN-SPAM / deliverability best practice). */
function notifyFooter(anyAppUrl: string, unsubUrl?: string): string {
  const origin = anyAppUrl.replace(/^(https?:\/\/[^/]+).*$/, "$1");
  const href = unsubUrl ?? `${origin}/dashboard`;
  return `<a href="${href}" style="color:#7c3aed;text-decoration:none">Unsubscribe from these notifications</a> — one click, no login needed. Questions? Just reply. — The AIBeatSync team`;
}

/** "Your render didn't finish" — honest, calm, with a support-ticket path. */
export function renderFailedEmailHtml(p: { title: string; reason: string; jobUrl: string; supportUrl: string; unsubscribeUrl?: string }): string {
  const title = escapeHtml(p.title);
  const reason = escapeHtml(p.reason.slice(0, 200));
  return emailShell(
    `
      <h1 style="font-size:22px;margin:0 0 12px">Your render didn't finish 😕</h1>
      <p style="font-size:15px;line-height:1.6;color:#333;margin:0 0 16px">
        We hit a problem while rendering <strong>“${title}”</strong> and couldn't complete it.
      </p>
      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:12px 16px;font-size:14px;color:#991b1b;line-height:1.5">
        ${reason}
      </div>
      ${ctaButton(p.supportUrl, "Create a support ticket →")}
      <p style="font-size:14px;line-height:1.6;color:#555;margin:0">
        <strong>Please don't retry and spend more credits</strong> — create a support ticket instead
        and we'll fix the job or make it right. You can also review the job
        <a href="${p.jobUrl}" style="color:#7c3aed;text-decoration:none;font-weight:600">here</a>.
      </p>
    `,
    { footerNote: notifyFooter(p.jobUrl, p.unsubscribeUrl) },
  );
}

// ---------------------------------------------------------------------------
// Admin emails (same shell, table-first content)
// ---------------------------------------------------------------------------

export function adminEmailHtml(p: { heading: string; intro?: string; rows: string; ctaHref?: string; ctaLabel?: string }): string {
  return emailShell(
    `
      <h1 style="font-size:20px;margin:0 0 12px">${p.heading}</h1>
      ${p.intro ? `<p style="font-size:14px;line-height:1.6;color:#555;margin:0 0 12px">${p.intro}</p>` : ""}
      ${detailTable(p.rows)}
      ${p.ctaHref ? ctaButton(p.ctaHref, p.ctaLabel ?? "Open Admin →") : ""}
    `,
    { footerNote: "Automated admin alert from AIBeatSync." },
  );
}
