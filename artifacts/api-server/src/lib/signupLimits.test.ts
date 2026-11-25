import { describe, expect, it } from "vitest";
import { maxAccountsPerIp, signupIpWindowDays, signupIpWindowStart } from "./signupLimits.js";

const env = (v: Record<string, string>) => v as NodeJS.ProcessEnv;

describe("signup IP limits", () => {
  it("defaults to 5 accounts per 7-day window", () => {
    expect(maxAccountsPerIp(env({}))).toBe(5);
    expect(signupIpWindowDays(env({}))).toBe(7);
  });

  it("reads overrides, and 0 disables the per-IP cap", () => {
    expect(maxAccountsPerIp(env({ MAX_ACCOUNTS_PER_IP: "2" }))).toBe(2);
    expect(maxAccountsPerIp(env({ MAX_ACCOUNTS_PER_IP: "0" }))).toBe(0);
    expect(signupIpWindowDays(env({ SIGNUP_IP_WINDOW_DAYS: "1" }))).toBe(1);
  });

  it("falls back to defaults for garbage or negative values", () => {
    expect(maxAccountsPerIp(env({ MAX_ACCOUNTS_PER_IP: "abc" }))).toBe(5);
    expect(maxAccountsPerIp(env({ MAX_ACCOUNTS_PER_IP: "-3" }))).toBe(5);
    expect(signupIpWindowDays(env({ SIGNUP_IP_WINDOW_DAYS: "0" }))).toBe(7);
    expect(signupIpWindowDays(env({ SIGNUP_IP_WINDOW_DAYS: "-1" }))).toBe(7);
  });

  it("computes the rolling window start", () => {
    const now = Date.parse("2026-01-10T00:00:00Z");
    expect(signupIpWindowStart(now, 7).toISOString()).toBe("2026-01-03T00:00:00.000Z");
    expect(signupIpWindowStart(now, 1).toISOString()).toBe("2026-01-09T00:00:00.000Z");
  });
});
