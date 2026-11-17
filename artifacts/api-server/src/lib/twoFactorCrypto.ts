import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { Secret, TOTP } from "otpauth";

function key() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("Two-factor encryption is not configured");
  // Domain-separated from session signing. Keep SESSION_SECRET stable; rotate
  // only with a deliberate re-encryption of existing authenticator seeds.
  return Buffer.from(hkdfSync("sha256", secret, "aibeatsync", "totp-encryption-v1", 32));
}

export function encryptSeed(seed: string, userId: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(userId));
  const encrypted = Buffer.concat([cipher.update(seed, "utf8"), cipher.final()]);
  return ["v1", iv.toString("hex"), cipher.getAuthTag().toString("hex"), encrypted.toString("hex")].join(".");
}

export function decryptSeed(value: string, userId: string): string {
  const [version, iv, tag, encrypted] = value.split(".");
  if (version !== "v1" || !iv || !tag || !encrypted) throw new Error("Invalid encrypted authenticator");
  const cipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "hex"));
  cipher.setAAD(Buffer.from(userId));
  cipher.setAuthTag(Buffer.from(tag, "hex"));
  return Buffer.concat([cipher.update(Buffer.from(encrypted, "hex")), cipher.final()]).toString("utf8");
}

export function newAuthenticator(email: string) {
  return new TOTP({ issuer: "AIBeatSync", label: email, algorithm: "SHA1", digits: 6, period: 30, secret: new Secret({ size: 20 }) });
}

export function validStep(seed: string, code: string, lastUsedStep: number, now = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const totp = new TOTP({ secret: Secret.fromBase32(seed), algorithm: "SHA1", digits: 6, period: 30 });
  const delta = totp.validate({ token: code, timestamp: now, window: 1 });
  if (delta === null) return null;
  const step = Math.floor(now / 30_000) + delta;
  return step > lastUsedStep ? step : null;
}

export function recoveryHash(code: string): string {
  return createHash("sha256").update(code.replace(/[\s-]/g, "").toLowerCase()).digest("hex");
}

export function recoveryIndex(hashes: string[], code: string): number {
  if (!/^[a-fA-F0-9\s-]{32,64}$/.test(code)) return -1;
  const value = Buffer.from(recoveryHash(code), "hex");
  return hashes.findIndex((hash) => {
    const expected = Buffer.from(hash, "hex");
    return expected.length === value.length && timingSafeEqual(expected, value);
  });
}

export function newRecoveryCodes() {
  const codes = Array.from({ length: 10 }, () => randomBytes(16).toString("hex").match(/.{4}/g)!.join("-"));
  return { codes, hashes: codes.map(recoveryHash) };
}
