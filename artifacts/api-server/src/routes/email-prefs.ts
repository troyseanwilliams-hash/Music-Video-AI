// One-click, no-login email unsubscribe (RFC 8058 / CAN-SPAM).
//
// Links in notification emails point at GET /api/email/unsubscribe?uid=&token=
// (browser confirmation page); mail clients hit the same URL with POST for
// Gmail/Yahoo "one-click unsubscribe". The token is an HMAC of the user id —
// no login or DB token table needed. Only affects notify_on_complete;
// security emails (password reset) always send.

import { Router, type IRouter, type Request, type Response } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { verifyUnsubscribeToken } from "../lib/emailTemplates.js";

const router: IRouter = Router();

function page(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} — AIBeatSync</title></head>
  <body style="margin:0;background:#0b0714;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
    <div style="max-width:480px;margin:80px auto;padding:40px 32px;background:#fff;border-radius:16px;text-align:center">
      <span style="display:inline-block;background:linear-gradient(90deg,#7c3aed,#2563eb);color:#fff;font-weight:700;font-size:18px;padding:8px 18px;border-radius:10px;margin-bottom:20px">AIBeatSync</span>
      <h1 style="font-size:20px;margin:8px 0 12px;color:#111">${title}</h1>
      <div style="font-size:15px;line-height:1.6;color:#444">${body}</div>
    </div>
  </body></html>`;
}

async function setNotify(uid: string, token: string, value: boolean): Promise<"ok" | "bad-token" | "not-found"> {
  if (!uid || !token || !verifyUnsubscribeToken(uid, token)) return "bad-token";
  const updated = await db
    .update(usersTable)
    .set({ notifyOnComplete: value })
    .where(eq(usersTable.id, uid))
    .returning({ id: usersTable.id });
  return updated.length ? "ok" : "not-found";
}

async function handleUnsubscribe(req: Request, res: Response, respondHtml: boolean): Promise<void> {
  const uid = String(req.query.uid ?? "");
  const token = String(req.query.token ?? "");
  const result = await setNotify(uid, token, false);
  if (result !== "ok") {
    if (respondHtml) {
      res.status(400).send(page("Link not valid", "This unsubscribe link is invalid or out of date. You can manage email notifications from your dashboard instead."));
    } else {
      res.status(400).json({ error: "Invalid unsubscribe link" });
    }
    return;
  }
  if (respondHtml) {
    const resubUrl = `/api/email/resubscribe?uid=${encodeURIComponent(uid)}&token=${encodeURIComponent(token)}`;
    res.send(page(
      "You're unsubscribed",
      `You won't receive video notification emails anymore. Security emails (like password resets) still send.<br><br>
       Changed your mind? <a href="${resubUrl}" style="color:#7c3aed;font-weight:600;text-decoration:none">Resubscribe with one click</a>.`,
    ));
  } else {
    res.json({ ok: true });
  }
}

// Browser click → confirmation page.
router.get("/email/unsubscribe", (req, res) => void handleUnsubscribe(req, res, true));
// RFC 8058 one-click (mail clients POST to the same URL).
router.post("/email/unsubscribe", (req, res) => void handleUnsubscribe(req, res, false));

router.get("/email/resubscribe", async (req: Request, res: Response) => {
  const uid = String(req.query.uid ?? "");
  const token = String(req.query.token ?? "");
  const result = await setNotify(uid, token, true);
  if (result !== "ok") {
    res.status(400).send(page("Link not valid", "This link is invalid or out of date. You can manage email notifications from your dashboard instead."));
    return;
  }
  res.send(page("Welcome back 🎬", "You'll get an email whenever one of your videos finishes rendering."));
});

export default router;
