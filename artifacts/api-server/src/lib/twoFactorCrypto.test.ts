import { afterEach, describe, expect, it, vi } from "vitest";
import { TOTP } from "otpauth";
import { decryptSeed, encryptSeed, newAuthenticator, newRecoveryCodes, recoveryHash, recoveryIndex, validStep } from "./twoFactorCrypto.js";

afterEach(() => vi.unstubAllEnvs());
describe("two-factor cryptography", () => {
  it("encrypts seeds with random nonces and binds them to the account", () => {
    vi.stubEnv("SESSION_SECRET", "synthetic-test-key-01234567890123456789");
    const seed = newAuthenticator("fixture@example.invalid").secret.base32;
    const encrypted = encryptSeed(seed, "fixture-a");
    expect(encrypted).not.toContain(seed);
    expect(encryptSeed(seed, "fixture-a")).not.toEqual(encrypted);
    expect(decryptSeed(encrypted, "fixture-a")).toBe(seed);
    expect(() => decryptSeed(encrypted, "fixture-b")).toThrow();
    expect(() => decryptSeed(encrypted.slice(0, -2) + "ff", "fixture-a")).toThrow();
  });
  it("fails closed without a sufficiently strong configured encryption key", () => {
    vi.stubEnv("SESSION_SECRET", "");
    expect(() => encryptSeed("TEST", "fixture")).toThrow();
  });
  it("matches the RFC 6238 SHA1 test vector and rejects replay and old codes", () => {
    const seed = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    expect(validStep(seed, "287082", -1, 59_000)).toBe(1);
    expect(validStep(seed, "287082", 1, 59_000)).toBeNull();
    expect(validStep(seed, "287082", -1, 180_000)).toBeNull();
    expect(validStep(seed, "not-a-code", -1, 59_000)).toBeNull();
  });
  it("allows only the adjacent clock-skew window", () => {
    const authenticator = newAuthenticator("fixture@example.invalid");
    const now = 1_800_000;
    expect(validStep(authenticator.secret.base32, authenticator.generate({ timestamp: now - 30_000 }), -1, now)).toBe(59);
    expect(validStep(authenticator.secret.base32, authenticator.generate({ timestamp: now + 60_000 }), -1, now)).toBeNull();
    expect(TOTP.validate({ token: authenticator.generate({ timestamp: now }), secret: authenticator.secret, timestamp: now })).toBe(0);
  });
  it("generates ten unique high-entropy codes and only stores hashes", () => {
    const { codes, hashes } = newRecoveryCodes();
    expect(new Set(codes).size).toBe(10);
    expect(codes[0].replaceAll("-", "")).toHaveLength(32);
    expect(hashes).not.toContain(codes[0]);
    expect(recoveryIndex(hashes, codes[0].toUpperCase())).toBe(0);
    expect(recoveryIndex(hashes.slice(1), codes[0])).toBe(-1);
    expect(recoveryHash(codes[0].replaceAll("-", " "))).toBe(hashes[0]);
    expect(recoveryIndex(hashes, "000000")).toBe(-1);
  });
});
