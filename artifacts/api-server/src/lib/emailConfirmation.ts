import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { Resend } from "resend";
import { emailShell } from "./emailTemplates.js";
import { logger } from "./logger.js";

export const EMAIL_CODE_TTL = 15 * 60_000;
export const EMAIL_RESEND_COOLDOWN = 60_000;

export function emailCodeHash(userId: string, code: string): string {
  const key = process.env.SESSION_SECRET;
  if (!key) throw new Error("Email verification signing is not configured");
  return createHmac("sha256", key).update(`email-confirmation:v1:${userId}:${code}`).digest("hex");
}

export function newEmailCode(userId: string) {
  const code = randomInt(0, 100_000_000).toString().padStart(8, "0");
  return { code, hash: emailCodeHash(userId, code), expiresAt: new Date(Date.now() + EMAIL_CODE_TTL) };
}

export function matchesEmailCode(userId: string, code: string, hash: string): boolean {
  if (!/^\d{8}$/.test(code)) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = Buffer.from(emailCodeHash(userId, code), "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// Security mail: no unsubscribe links, no login links, no code in logs.
// An explicit false lets the UI offer recovery instead of claiming delivery.
export async function sendEmailConfirmation(userId: string, email: string, code: string): Promise<boolean> {
  if (!process.env.RESEND_API_KEY) {
    logger.error({ userId }, "Email confirmation service is not configured");
    return false;
  }
  try {
    const { data, error } = await new Resend(process.env.RESEND_API_KEY).emails.send({
      from: "AIBeatSync <notifications@aibeatsync.com>",
      to: email,
      subject: "Confirm your AIBeatSync email address",
      text: `Your AIBeatSync email confirmation code is ${code}. Enter it on the sign-up confirmation screen along with your password. It expires in 15 minutes. If you did not create this account, ignore this email. Never share this code.`,
      html: emailShell(`<h1 style="font-size:22px">Confirm your email address</h1><p>Enter this code on the AIBeatSync confirmation screen to finish creating your account:</p><p style="font-size:30px;font-weight:bold;letter-spacing:5px">${code}</p><p>This code expires in 15 minutes. You will also need the password you chose at sign-up.</p><p>If you did not create this account, ignore this email. Never share this code.</p>`),
    });
    if (error || !data?.id) {
      logger.error({ userId }, "Email confirmation delivery was rejected");
      return false;
    }
    return true;
  } catch {
    logger.error({ userId }, "Email confirmation delivery failed");
    return false;
  }
}
