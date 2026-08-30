import crypto from "node:crypto";
import fs from "node:fs/promises";

const campaignId = "aibeatsync-generate-video-full-list-2026-08-30-v2";
if (process.env.CONFIRM_CAMPAIGN_SEND !== campaignId) {
  throw new Error("Campaign send confirmation is missing");
}

const recipients = JSON.parse(
  await fs.readFile("/tmp/aibeatsync-campaign-recipients.json", "utf8"),
);
const apiKey = process.env.RESEND_API_KEY;
const unsubscribeSecret = process.env.SESSION_SECRET;
if (!apiKey || !unsubscribeSecret) {
  throw new Error("Required mail secrets are unavailable");
}

const appUrl = "https://aibeatsync.com";
const youtubeUrl = "https://www.youtube.com/shorts/7bL-ts1M6R8";
const subject = "Build the story before you render.";
const startBatch = Math.max(0, Number.parseInt(process.env.START_BATCH ?? "0", 10) || 0);

function unsubscribeUrl(userId) {
  const token = crypto
    .createHmac("sha256", unsubscribeSecret)
    .update(`unsub:${userId}`)
    .digest("hex")
    .slice(0, 32);
  return `${appUrl}/api/email/unsubscribe?uid=${encodeURIComponent(userId)}&token=${token}`;
}

function htmlFor(unsub) {
  return `<!doctype html><html><body style="margin:0;background:#0b0a11;color:#f7f4ff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
  <div style="max-width:640px;margin:0 auto;padding:28px 16px 48px"><div style="border:1px solid #282238;border-radius:18px;overflow:hidden;background:#12101a">
    <div style="padding:20px 28px;border-bottom:1px solid rgba(255,255,255,.08);font-weight:700;font-size:16px"><span style="display:inline-block;background:linear-gradient(135deg,#9d37ff,#397eff);padding:7px 9px;border-radius:8px;margin-right:8px">▣</span> AIBeatSync</div>
    <div style="padding:48px 38px 42px;background:linear-gradient(145deg,#1b1230,#101e42 78%)">
      <div style="display:inline-block;padding:7px 11px;border-radius:99px;color:#d9b9ff;border:1px solid rgba(203,143,255,.38);background:rgba(65,24,114,.42);font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">✦ New in AIBeatSync</div>
      <h1 style="font-size:44px;line-height:1;letter-spacing:-.05em;margin:22px 0 18px">Build the story <span style="color:#a97aff">before you render.</span></h1>
      <p style="color:#d5cce2;font-size:16px;line-height:1.55;margin:0">Meet the new Generate Video experience: scene-by-scene direction, stronger character continuity, and image approvals before animation begins.</p>
      <div style="margin-top:28px"><a href="${youtubeUrl}" style="display:inline-block;padding:13px 19px;border-radius:9px;background:linear-gradient(105deg,#a735ff,#387fff);color:#fff;font-size:13px;font-weight:700;text-decoration:none">Watch on YouTube&nbsp; ↗</a></div>
      <p style="color:#a99fba;font-size:11px;margin:17px 0 0">Your visual direction stays in your hands from the first scene to the final frame.</p>
    </div>
    <div style="padding:38px 38px 6px">
      <p style="color:#b889ff;font-size:11px;font-weight:700;letter-spacing:.13em;text-transform:uppercase;margin:0 0 8px">A better way to direct</p>
      <h2 style="font-size:28px;line-height:1.08;letter-spacing:-.045em;margin:0">See the whole visual story before you spend time rendering it.</h2>
      <p style="color:#aaa3b6;font-size:14px;line-height:1.6;margin:13px 0 24px">Generate Video turns your concept into a connected sequence of scenes. Every image has a purpose, every moment moves the story forward, and you get to review the direction before the final video is made.</p>
      <div style="border-top:1px solid #2a2336">
        <p style="padding:22px 0;margin:0;border-bottom:1px solid #2a2336"><strong>01&nbsp; Generate every scene with intention</strong><br/><span style="color:#a9a1b2;font-size:13px;line-height:1.56">Start with one idea and get a chronological visual plan for each moment.</span></p>
        <p style="padding:22px 0;margin:0;border-bottom:1px solid #2a2336"><strong>02&nbsp; Keep your character recognizable</strong><br/><span style="color:#a9a1b2;font-size:13px;line-height:1.56">Optional Character Reference helps guide a recurring character through changing scenes.</span></p>
        <p style="padding:22px 0;margin:0;border-bottom:1px solid #2a2336"><strong>03&nbsp; Preview and approve every image</strong><br/><span style="color:#a9a1b2;font-size:13px;line-height:1.56">Review the complete image sequence before animation begins.</span></p>
        <p style="padding:22px 0;margin:0;border-bottom:1px solid #2a2336"><strong>04&nbsp; Regenerate only what needs work</strong><br/><span style="color:#a9a1b2;font-size:13px;line-height:1.56">Change one scene while keeping the rest of your visual sequence intact.</span></p>
      </div>
      <div style="margin:32px 0 6px;padding:21px 22px;border:1px solid #5b3e96;border-radius:12px;background:linear-gradient(135deg,rgba(87,41,138,.38),rgba(39,67,134,.22))"><h3 style="font-size:19px;margin:0">Approve first. Animate second.</h3><p style="color:#c3b8d2;font-size:13px;line-height:1.55;margin:8px 0 0"><strong style="color:#f2eaff">You stay in control before video generation begins.</strong> Once your images are approved, Generate Video brings the complete sequence to life.</p></div>
    </div>
    <div style="margin:40px 38px 42px;padding:28px 22px;text-align:center;border-radius:13px;background:linear-gradient(135deg,#201235,#142a51);border:1px solid #3b376b"><h2 style="font-size:26px;line-height:1.1;margin:0">Your music deserves a visual story.</h2><p style="color:#bdb2cc;font-size:13px;line-height:1.55;margin:11px auto 19px">Shape every scene, keep your characters consistent, and make the final call before your video renders.</p><a href="${youtubeUrl}" style="display:inline-block;padding:13px 19px;border-radius:9px;background:linear-gradient(105deg,#a735ff,#387fff);color:#fff;font-size:13px;font-weight:700;text-decoration:none">Watch the finished video&nbsp; ↗</a></div>
    <div style="padding:24px 28px 29px;border-top:1px solid #292331;text-align:center;color:#797282;font-size:11px;line-height:1.6"><strong style="color:#b9b0c6">AIBeatSync</strong><br/>Create connected music videos with more creative control.<br/><a href="${appUrl}/settings" style="color:#9d83c7">Manage email preferences</a> &nbsp;·&nbsp; <a href="${unsub}" style="color:#9d83c7">Unsubscribe</a></div>
  </div></div></body></html>`;
}

function textFor(unsub) {
  return `Build the story before you render.\n\nMeet the new Generate Video experience: scene-by-scene direction, stronger character continuity, and image approvals before animation begins.\n\nWatch on YouTube: ${youtubeUrl}\n\nGenerate Video lets you shape the visual story, preview every image, approve the direction, and animate only when it feels right.\n\nCreate your next video: ${appUrl}/generate\n\nManage email preferences: ${appUrl}/settings\nUnsubscribe: ${unsub}`;
}

let sent = 0;
for (let start = startBatch * 100, batchNumber = startBatch; start < recipients.length; start += 100, batchNumber++) {
  const batch = recipients.slice(start, start + 100).map(({ id, email }) => {
    const unsub = unsubscribeUrl(id);
    return {
      from: "AIBeatSync <notifications@aibeatsync.com>",
      to: [email],
      subject,
      html: htmlFor(unsub),
      text: textFor(unsub),
      headers: {
        "List-Unsubscribe": `<${unsub}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    };
  });
  const response = await fetch("https://api.resend.com/emails/batch", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `${campaignId}-batch-${batchNumber}`,
    },
    body: JSON.stringify(batch),
  });
  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`Resend batch ${batchNumber + 1} failed with HTTP ${response.status}: ${responseText.slice(0, 300)}`);
  }
  sent += batch.length;
  console.log(`Sent batch ${batchNumber + 1} (${batch.length} recipients).`);
}
console.log(`Campaign send complete: ${sent} recipients.`);