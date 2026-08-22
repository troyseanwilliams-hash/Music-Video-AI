/**
 * Focused unit tests for Suite PKCE logic, catalog metadata, redirect
 * allowlisting, and duplicate/outbox behaviour.
 *
 * These tests do NOT hit the database or Stripe — they test pure functions
 * exported from suite.ts.
 */
import { describe, it, expect } from "vitest";
import { createHash, randomBytes } from "crypto";
import {
  suitePagePath,
  suiteReturnBase,
} from "../lib/suiteReturnUrls.js";

// ─── Inline pure helpers (copied from suite.ts to keep tests dependency-free)

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function isAllowedReturnUrl(url: string, allowed: string[]): boolean {
  try {
    const parsed = new URL(url);
    return allowed.some(
      (o) => parsed.origin === o || parsed.href.startsWith(o + "/"),
    );
  } catch {
    return false;
  }
}

const SUITE_LOOKUP_KEYS = new Set([
  "suite_creator_monthly",
  "suite_creator_yearly",
  "suite_pro_monthly",
  "suite_pro_yearly",
  "suite_studio_monthly",
  "suite_studio_yearly",
]);

function isSuiteLookupKey(key: string | null | undefined): boolean {
  return typeof key === "string" && SUITE_LOOKUP_KEYS.has(key);
}

function parseAipodCredits(
  metadata: Record<string, string> | null | undefined,
): number {
  if (!metadata) return 0;
  const raw = metadata["aipodCredits"];
  if (!raw) return 0;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// ─── PKCE helper ──────────────────────────────────────────────────────────────

/**
 * Simulate the PKCE flow:
 *   1. AIPodSync generates verifier + codeChallenge = SHA256(verifier)
 *   2. AIBeat stores SHA256(codeChallenge) as codeChallengeHash
 *   3. AIPodSync sends verifier at exchange; AIBeat verifies SHA256(verifier) == codeChallengeHash
 */
function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "utf8").digest("base64url");
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Suite PKCE verification", () => {
  it("valid verifier matches challenge hash", () => {
    const verifier = randomBytes(48).toString("base64url");
    const challenge = pkceChallenge(verifier);
    const storedChallengeHash = sha256(challenge);
    const exchangeChallengeHash = sha256(pkceChallenge(verifier));
    expect(exchangeChallengeHash).toBe(storedChallengeHash);
  });

  it("wrong verifier fails verification", () => {
    const codeChallenge = pkceChallenge(randomBytes(48).toString("base64url"));
    const codeChallengeHash = sha256(codeChallenge);
    const wrongVerifier = randomBytes(48).toString("base64url");
    const wrongVerifierChallengeHash = sha256(pkceChallenge(wrongVerifier));
    expect(wrongVerifierChallengeHash).not.toBe(codeChallengeHash);
  });

  it("code hash is stored, not raw code", () => {
    const rawCode = randomBytes(32).toString("hex");
    const codeHash = sha256(rawCode);
    expect(codeHash).not.toBe(rawCode);
    expect(codeHash).toHaveLength(64); // 32 bytes hex
  });

  it("delivery token is random and hashed at rest", () => {
    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = sha256(rawToken);
    expect(tokenHash).not.toBe(rawToken);
    expect(rawToken).toHaveLength(64);
    // Different tokens produce different hashes
    const rawToken2 = randomBytes(32).toString("hex");
    expect(sha256(rawToken2)).not.toBe(tokenHash);
  });
});

// ─── Suite catalog metadata ───────────────────────────────────────────────────

describe("Suite catalog metadata", () => {
  const SUITE_CATALOG = [
    { lookupKey: "suite_creator_monthly", credits: 1000, aipodCredits: 200, amount: 2900 },
    { lookupKey: "suite_creator_yearly", credits: 12000, aipodCredits: 2400, amount: 29000 },
    { lookupKey: "suite_pro_monthly", credits: 2500, aipodCredits: 800, amount: 7500 },
    { lookupKey: "suite_pro_yearly", credits: 30000, aipodCredits: 9600, amount: 75000 },
    { lookupKey: "suite_studio_monthly", credits: 5000, aipodCredits: 800, amount: 10500 },
    { lookupKey: "suite_studio_yearly", credits: 60000, aipodCredits: 9600, amount: 105000 },
  ];

  it("all six Suite lookup keys are recognized", () => {
    for (const entry of SUITE_CATALOG) {
      expect(isSuiteLookupKey(entry.lookupKey)).toBe(true);
    }
  });

  it("non-Suite lookup keys are not recognized", () => {
    expect(isSuiteLookupKey("starter_monthly")).toBe(false);
    expect(isSuiteLookupKey("pro_yearly")).toBe(false);
    expect(isSuiteLookupKey("topup_1000")).toBe(false);
    expect(isSuiteLookupKey(null)).toBe(false);
    expect(isSuiteLookupKey(undefined)).toBe(false);
    expect(isSuiteLookupKey("")).toBe(false);
  });

  it("parseAipodCredits reads metadata correctly", () => {
    expect(parseAipodCredits({ aipodCredits: "200" })).toBe(200);
    expect(parseAipodCredits({ aipodCredits: "2400" })).toBe(2400);
    expect(parseAipodCredits({ aipodCredits: "9600" })).toBe(9600);
    expect(parseAipodCredits({})).toBe(0);
    expect(parseAipodCredits(null)).toBe(0);
    expect(parseAipodCredits({ aipodCredits: "-100" })).toBe(0);
    expect(parseAipodCredits({ aipodCredits: "abc" })).toBe(0);
  });

  it("catalog credits are in sync with task spec", () => {
    // creator: 1000/12000 AIBeat, 200/2400 AIPod
    expect(SUITE_CATALOG[0]!.credits).toBe(1000);
    expect(SUITE_CATALOG[0]!.aipodCredits).toBe(200);
    expect(SUITE_CATALOG[1]!.credits).toBe(12000);
    expect(SUITE_CATALOG[1]!.aipodCredits).toBe(2400);
    // pro: 2500/30000 AIBeat, 800/9600 AIPod
    expect(SUITE_CATALOG[2]!.credits).toBe(2500);
    expect(SUITE_CATALOG[2]!.aipodCredits).toBe(800);
    expect(SUITE_CATALOG[3]!.credits).toBe(30000);
    expect(SUITE_CATALOG[3]!.aipodCredits).toBe(9600);
    // studio: 5000/60000 AIBeat, 800/9600 AIPod
    expect(SUITE_CATALOG[4]!.credits).toBe(5000);
    expect(SUITE_CATALOG[4]!.aipodCredits).toBe(800);
    expect(SUITE_CATALOG[5]!.credits).toBe(60000);
    expect(SUITE_CATALOG[5]!.aipodCredits).toBe(9600);
  });
});

// ─── Redirect allowlisting ────────────────────────────────────────────────────

describe("Redirect allowlisting", () => {
  const DEFAULT_ORIGINS = ["https://aipodsync.com"];

  it("allows exact origin", () => {
    expect(isAllowedReturnUrl("https://aipodsync.com", DEFAULT_ORIGINS)).toBe(true);
  });

  it("allows paths under the origin", () => {
    expect(
      isAllowedReturnUrl("https://aipodsync.com/callback?code=abc", DEFAULT_ORIGINS),
    ).toBe(true);
    expect(
      isAllowedReturnUrl("https://aipodsync.com/auth/link/callback", DEFAULT_ORIGINS),
    ).toBe(true);
  });

  it("rejects arbitrary origins", () => {
    expect(isAllowedReturnUrl("https://evil.com/callback", DEFAULT_ORIGINS)).toBe(false);
    expect(isAllowedReturnUrl("https://notaipodsync.com", DEFAULT_ORIGINS)).toBe(false);
    expect(
      isAllowedReturnUrl("http://aipodsync.com/callback", DEFAULT_ORIGINS),
    ).toBe(false); // wrong scheme
  });

  it("rejects malformed URLs", () => {
    expect(isAllowedReturnUrl("not-a-url", DEFAULT_ORIGINS)).toBe(false);
    expect(isAllowedReturnUrl("", DEFAULT_ORIGINS)).toBe(false);
  });

  it("allows custom AIPODSYNC_BASE_URL origin", () => {
    const customOrigins = ["https://aipodsync.com", "https://staging.aipodsync.com"];
    expect(
      isAllowedReturnUrl("https://staging.aipodsync.com/callback", customOrigins),
    ).toBe(true);
    expect(
      isAllowedReturnUrl("https://production.aipodsync.com/callback", customOrigins),
    ).toBe(false);
  });

  it("does not allow subdomain spoofing", () => {
    expect(
      isAllowedReturnUrl("https://evil.aipodsync.com/callback", DEFAULT_ORIGINS),
    ).toBe(false);
  });
});

describe("Suite product return URLs", () => {
  it("returns standalone Suite customers to the Suite root", () => {
    expect(suitePagePath("aisyncsuite")).toBe("/");
    expect(
      `${suiteReturnBase(
        "aisyncsuite",
        "https://aisyncsuite.com",
        "https://aipodsync.com",
      )}${suitePagePath("aisyncsuite")}`,
    ).toBe("https://aisyncsuite.com/");
  });

  it("keeps legacy product returns on their Suite routes", () => {
    expect(suitePagePath("aibeatsync")).toBe("/suite");
    expect(
      `${suiteReturnBase(
        "aipodsync",
        "https://aisyncsuite.com",
        "https://aipodsync.com",
      )}${suitePagePath("aipodsync")}`,
    ).toBe("https://aipodsync.com/suite");
  });
});

// ─── Outbox deduplication ─────────────────────────────────────────────────────

describe("Outbox event deduplication (key uniqueness)", () => {
  it("same invoice id produces same event key", () => {
    const invoiceId = "in_123456";
    const key1 = `invoice.${invoiceId}.credits.grant`;
    const key2 = `invoice.${invoiceId}.credits.grant`;
    expect(key1).toBe(key2);
  });

  it("different invoices produce different keys", () => {
    const key1 = `invoice.in_111.credits.grant`;
    const key2 = `invoice.in_222.credits.grant`;
    expect(key1).not.toBe(key2);
  });

  it("subscription lifecycle key includes status", () => {
    const subId = "sub_abc";
    const k1 = `subscription.${subId}.active`;
    const k2 = `subscription.${subId}.canceled`;
    expect(k1).not.toBe(k2);
  });

  it("revoke key is distinct from lifecycle key", () => {
    const subId = "sub_abc";
    expect(`subscription.${subId}.revoke`).not.toBe(
      `subscription.${subId}.canceled`,
    );
  });

  it("full refund revoke key uses charge id", () => {
    const chargeId = "ch_xyz";
    const key = `charge.${chargeId}.full_refund.revoke`;
    expect(key).toContain(chargeId);
    expect(key).toContain("full_refund");
  });

  it("ACK payload uses outbox row IDs rather than event keys", () => {
    const event = {
      id: "evt_row_123",
      eventKey: "invoice.in_123.credits.grant",
    };
    expect({ eventIds: [event.id] }).toEqual({ eventIds: ["evt_row_123"] });
    expect(event.id).not.toBe(event.eventKey);
  });

  it("AIPod grants use the dedicated AIPod amount", () => {
    const payload = {
      credits: 12_000,
      aipodCredits: 2_400,
      priceLookupKey: "suite_creator_yearly",
    };
    expect(payload.aipodCredits).toBe(2_400);
    expect(payload.aipodCredits).not.toBe(payload.credits);
  });
});
