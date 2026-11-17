import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const send = vi.hoisted(() => vi.fn());
vi.mock("resend", () => ({ Resend: class { emails = { send }; } }));
import { emailCodeHash, matchesEmailCode, newEmailCode, sendEmailConfirmation } from "./emailConfirmation.js";

beforeEach(() => { vi.stubEnv("SESSION_SECRET", "fixture-only-email-signing-key"); send.mockReset(); });
afterEach(() => vi.unstubAllEnvs());
describe("email confirmation security and delivery", () => {
  it("generates an expiring eight-digit code, never a stored plaintext code", () => {
    const result = newEmailCode("fixture");
    expect(result.code).toMatch(/^\d{8}$/);
    expect(result.hash).toHaveLength(64);
    expect(result.hash).not.toBe(result.code);
    expect(result.expiresAt.getTime() - Date.now()).toBeGreaterThan(14 * 60_000);
    expect(matchesEmailCode("fixture", result.code, result.hash)).toBe(true);
    expect(matchesEmailCode("another-account", result.code, result.hash)).toBe(false);
    expect(matchesEmailCode("fixture", "invalid", result.hash)).toBe(false);
  });
  it("fails closed if signing is not configured", () => {
    vi.stubEnv("SESSION_SECRET", "");
    expect(() => emailCodeHash("fixture", "12345678")).toThrow();
  });
  it("reports missing credentials and provider rejection as delivery failures", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    expect(await sendEmailConfirmation("fixture", "fixture@example.invalid", "12345678")).toBe(false);
    expect(send).not.toHaveBeenCalled();
    vi.stubEnv("RESEND_API_KEY", "fixture-key");
    send.mockResolvedValueOnce({ error: { message: "Rejected" } });
    expect(await sendEmailConfirmation("fixture", "fixture@example.invalid", "12345678")).toBe(false);
    send.mockRejectedValueOnce(new Error("transport"));
    expect(await sendEmailConfirmation("fixture", "fixture@example.invalid", "12345678")).toBe(false);
  });
  it("uses the security email template without unsubscribe or confirmation links", async () => {
    vi.stubEnv("RESEND_API_KEY", "fixture-key");
    send.mockResolvedValue({ data: { id: "fixture-message" }, error: null });
    expect(await sendEmailConfirmation("fixture", "fixture@example.invalid", "12345678")).toBe(true);
    const email = send.mock.calls[0][0];
    expect(email.html).toContain("12345678");
    expect(email.text).toContain("15 minutes");
    expect(email.html.toLowerCase()).not.toContain("unsubscribe");
    expect(email.headers).toBeUndefined();
  });
});
