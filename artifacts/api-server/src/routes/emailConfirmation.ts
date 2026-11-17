import { Router } from "express";
import bcrypt from "bcrypt";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { ConfirmAccountEmailBody, ConfirmAccountEmailResponse } from "@workspace/api-zod";
import { allowAuthAttempt, authOriginGuard } from "../lib/twoFactor.js";
import { EMAIL_RESEND_COOLDOWN, matchesEmailCode, newEmailCode, sendEmailConfirmation } from "../lib/emailConfirmation.js";
import { sendWelcomeEmail } from "../lib/notifications.js";
import { processReferralSignup } from "../lib/referrals.js";

const router = Router();
router.post("/auth/email-confirmation", authOriginGuard, async (req, res) => {
  const parsed = ConfirmAccountEmailBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Enter your email, password and confirmation code." }); return; }
  const { action, password } = parsed.data;
  const email = parsed.data.email.trim().toLowerCase();
  if (!(await allowAuthAttempt(`email-confirm-ip:${req.ip}`, 60)) ||
      !(await allowAuthAttempt(`email-confirm-account:${email}`, 15))) {
    res.status(429).json({ error: "Too many confirmation attempts. Wait 15 minutes and try again." }); return;
  }
  const result = await db.transaction(async (tx) => {
    const [user] = await tx.select().from(usersTable).where(eq(usersTable.email, email)).for("update");
    if (!user?.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
      return { status: 401, error: "Invalid email or password." };
    }
    if (user.isDisabled) return { status: 403, error: "This account has been disabled." };
    if (!user.emailVerificationRequired || user.emailVerifiedAt) return { status: 200, verified: true };
    if (action === "resend") {
      if (user.emailVerificationSentAt && Date.now() - user.emailVerificationSentAt.getTime() < EMAIL_RESEND_COOLDOWN) {
        return { status: 429, error: "Please wait one minute before requesting another code." };
      }
      const next = newEmailCode(user.id);
      await tx.update(usersTable).set({
        emailVerificationHash: next.hash,
        emailVerificationExpiresAt: next.expiresAt,
        emailVerificationSentAt: new Date(),
      }).where(eq(usersTable.id, user.id));
      return { status: 200, verified: false, send: { userId: user.id, email, code: next.code } };
    }
    if (!user.emailVerificationHash || !user.emailVerificationExpiresAt ||
        user.emailVerificationExpiresAt.getTime() <= Date.now() ||
        !matchesEmailCode(user.id, (parsed.data.code ?? "").trim(), user.emailVerificationHash)) {
      return { status: 400, error: "This code is incorrect or expired. Use the latest email, or request a new code." };
    }
    await tx.update(usersTable).set({
      emailVerifiedAt: new Date(), emailVerificationHash: null, emailVerificationExpiresAt: null,
      pendingReferralCode: null,
    }).where(eq(usersTable.id, user.id));
    return { status: 200, verified: true, confirmed: user };
  });
  if (result.error) { res.status(result.status).json({ error: result.error }); return; }
  let emailSent: boolean | undefined;
  if (result.send) emailSent = await sendEmailConfirmation(result.send.userId, result.send.email, result.send.code);
  if (result.confirmed) {
    const user = result.confirmed;
    sendWelcomeEmail({ id: user.id, email: user.email, name: [user.firstName, user.lastName].filter(Boolean).join(" ") || null });
    if (user.pendingReferralCode) await processReferralSignup(user.pendingReferralCode, user.id);
  }
  // Verification never creates a session or bypasses optional authenticator MFA.
  res.json(ConfirmAccountEmailResponse.parse({ verified: result.verified, ...(emailSent === undefined ? {} : { emailSent }) }));
});
export default router;
