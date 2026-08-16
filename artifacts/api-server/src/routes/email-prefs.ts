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

function creds(req: Request): { uid: string; token: string } {
  return { uid: String(req.query.uid ?? ""), token: String(req.query.token ?? "") };
}

function confirmForm(action: string, uid: string, token: string, label: string): string {
  return `<form method="POST" action="${action}?uid=${encodeURIComponent(uid)}&token=${encodeURIComponent(token)}" style="margin-top:20px">
    <button type="submit" style="background:linear-gradient(90deg,#7c3aed,#2563eb);color:#fff;font-weight:600;font-size:15px;border:0;cursor:pointer;padding:14px 32px;border-radius:10px">${label}</button>
  </form>`;
}

const BAD_LINK = page("Link not valid", "This link is invalid or out of date. You can manage email notifications from your dashboard instead.");

// Browser click → non-mutating confirmation page (email scanners follow GET
// links, so state only changes on POST).
router.get("/email/unsubscribe", (req: Request, res: Response) => {
  const { uid, token } = creds(req);
  if (!uid || !token || !verifyUnsubscribeToken(uid, token)) {
    res.status(400).send(BAD_LINK);
    return;
  }
  res.send(page(
    "Unsubscribe from notifications?",
    `You'll stop receiving video notification emails. Security emails (like password resets) still send.
     ${confirmForm("/api/email/unsubscribe", uid, token, "Yes, unsubscribe me")}`,
  ));
});

// Mutation: used by the confirmation form AND by RFC 8058 one-click mail clients.
router.post("/email/unsubscribe", async (req: Request, res: Response) => {
  const { uid, token } = creds(req);
  const result = await setNotify(uid, token, false);
  if (result !== "ok") {
    res.status(400).send(BAD_LINK);
    return;
  }
  const resub = confirmForm("/api/email/resubscribe", uid, token, "Resubscribe");
  res.send(page(
    "You're unsubscribed",
    `You won't receive video notification emails anymore. Changed your mind?${resub}`,
  ));
});

router.get("/email/resubscribe", (req: Request, res: Response) => {
  const { uid, token } = creds(req);
  if (!uid || !token || !verifyUnsubscribeToken(uid, token)) {
    res.status(400).send(BAD_LINK);
    return;
  }
  res.send(page(
    "Turn notifications back on?",
    `You'll get an email whenever one of your videos finishes rendering.
     ${confirmForm("/api/email/resubscribe", uid, token, "Yes, resubscribe me")}`,
  ));
});

router.post("/email/resubscribe", async (req: Request, res: Response) => {
  const { uid, token } = creds(req);
  const result = await setNotify(uid, token, true);
  if (result !== "ok") {
    res.status(400).send(BAD_LINK);
    return;
  }
  res.send(page("Welcome back 🎬", "You'll get an email whenever one of your videos finishes rendering."));
});

export default router;
