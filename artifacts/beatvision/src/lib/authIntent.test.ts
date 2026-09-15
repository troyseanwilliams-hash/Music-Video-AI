import { describe, expect, it } from "vitest";
import {
  buildAuthUrl,
  buildPricingIntent,
  getAuthCrossLinkDestination,
  getExplicitAuthDestination,
  getAuthIntent,
  normalizeReferralCode,
  normalizeTopupIdentifier,
  safeInternalDestination,
  AUTH_REGISTER_DEFAULT_DESTINATION,
} from "./authIntent";

describe("auth intent destinations", () => {
  it("allows known internal routes, including existing dynamic routes", () => {
    expect(safeInternalDestination("/pricing?plan=pro&interval=year")).toBe(
      "/pricing?plan=pro&interval=year",
    );
    expect(safeInternalDestination("/jobs/job-123?tab=details")).toBe(
      "/jobs/job-123?tab=details",
    );
    expect(safeInternalDestination("/generate?source=pricing")).toBe(
      "/generate?source=pricing",
    );
  });

  it("rejects external, protocol-relative, and double-encoded destinations", () => {
    expect(safeInternalDestination("https://evil.example/login")).toBeNull();
    expect(safeInternalDestination("//evil.example/login")).toBeNull();
    expect(safeInternalDestination("/%2F%2Fevil.example/login")).toBeNull();
    expect(safeInternalDestination("/%252F%252Fevil.example/login")).toBeNull();
    expect(
      safeInternalDestination("/pricing?next=%252F%252Fevil.example"),
    ).toBeNull();
    expect(safeInternalDestination("/jobs/%5C%5Cevil")).toBeNull();
  });

  it("does not decode a nested destination a second time", () => {
    expect(getAuthIntent("?returnTo=%252F%252Fevil.example")).toMatchObject({
      returnTo: "/dashboard",
    });
    expect(getAuthIntent("?returnTo=%2Fjobs%2Fjob-1")).toMatchObject({
      returnTo: "/jobs/job-1",
    });
  });
});

describe("auth intent preservation", () => {
  it("round-trips pricing selection through register, login, and back to pricing", () => {
    const registerUrl = buildAuthUrl("/register", {
      plan: "pro",
      interval: "year",
      referralCode: "invite-42",
      returnTo: buildPricingIntent("pro", "year", true),
      continueCheckout: true,
    });
    const registerIntent = getAuthIntent(registerUrl);

    const loginUrl = buildAuthUrl("/login", {
      returnTo: registerIntent.returnTo,
      plan: registerIntent.plan,
      interval: registerIntent.interval,
      referralCode: registerIntent.referralCode,
      continueCheckout: registerIntent.continueCheckout,
    });
    const loginIntent = getAuthIntent(loginUrl);
    const pricingIntent = getAuthIntent(loginIntent.returnTo);

    expect(loginIntent).toMatchObject({
      returnTo: "/pricing?plan=pro&interval=year&continue=1",
      plan: "pro",
      interval: "year",
      referralCode: "INVITE-42",
      continueCheckout: true,
    });
    expect(pricingIntent).toMatchObject({
      returnTo: "/pricing?plan=pro&interval=year&continue=1",
      plan: "pro",
      interval: "year",
      continueCheckout: true,
    });
  });

  it("preserves an allowlisted plan, interval, referral, and checkout intent", () => {
    const url = buildAuthUrl("/register", {
      plan: "pro",
      interval: "year",
      referralCode: "ab23cd45",
      returnTo: buildPricingIntent("pro", "year"),
      continueCheckout: true,
    });
    const intent = getAuthIntent(url);

    expect(intent).toEqual({
      returnTo: "/pricing?plan=pro&interval=year&continue=1",
      plan: "pro",
      interval: "year",
      topupId: null,
      referralCode: "AB23CD45",
      continueCheckout: true,
    });
    expect(url).toContain("returnTo=%2Fpricing%3Fplan%3Dpro");
    expect(url).not.toContain("%252F%252Fevil");
  });

  it("drops unallowlisted plan and referral values", () => {
    const intent = getAuthIntent(
      "?plan=enterprise&interval=week&ref=not%20a%20code&returnTo=%2Fpricing",
    );
    expect(intent.plan).toBeNull();
    expect(intent.interval).toBeNull();
    expect(intent.referralCode).toBeNull();
    expect(intent.returnTo).toBe("/pricing");
  });

  it("supports the existing `from` destination key", () => {
    expect(getAuthIntent("?from=%2Fjobs%2Fabc%3Fview%3Dfull").returnTo).toBe(
      "/jobs/abc?view=full",
    );
  });

  it("keeps an interval when the destination is explicitly pricing", () => {
    expect(
      getAuthIntent("?returnTo=%2Fpricing&interval=year").returnTo,
    ).toBe("/pricing?interval=year");
  });

  it("normalizes only safe referral codes", () => {
    expect(normalizeReferralCode(" ab23cd45 ")).toBe("AB23CD45");
    expect(normalizeReferralCode("email@example.com")).toBeNull();
    expect(normalizeReferralCode("A".repeat(33))).toBeNull();
  });

  it("preserves a catalog top-up price through register, login, and pricing", () => {
    const registerUrl = buildAuthUrl("/register", {
      topupId: "topup_250",
      referralCode: "friend-99",
      returnTo: buildPricingIntent(null, null, true, "topup_250"),
      continueCheckout: true,
    });
    const registerIntent = getAuthIntent(registerUrl);
    const loginUrl = buildAuthUrl("/login", {
      topupId: registerIntent.topupId,
      referralCode: registerIntent.referralCode,
      returnTo: registerIntent.returnTo,
      continueCheckout: registerIntent.continueCheckout,
    });
    const loginIntent = getAuthIntent(loginUrl);
    const pricingIntent = getAuthIntent(loginIntent.returnTo);

    expect(loginIntent).toMatchObject({
      returnTo: "/pricing?topup=topup_250&continue=1",
      topupId: "topup_250",
      referralCode: "FRIEND-99",
      continueCheckout: true,
    });
    expect(pricingIntent).toMatchObject({
      returnTo: "/pricing?topup=topup_250&continue=1",
      topupId: "topup_250",
      continueCheckout: true,
    });
  });

  it("keeps only safe top-up identifiers and separates auth defaults", () => {
    expect(normalizeTopupIdentifier("topup_250")).toBe("topup_250");
    expect(normalizeTopupIdentifier("price_1SafePrice")).toBe("price_1SafePrice");
    expect(normalizeTopupIdentifier("250 Credits")).toBeNull();
    expect(normalizeTopupIdentifier("topup_%2F%2Fevil")).toBeNull();
    expect(getAuthIntent("/register").returnTo).toBe("/generate");
    expect(
      getAuthIntent("/register", AUTH_REGISTER_DEFAULT_DESTINATION).returnTo,
    ).toBe("/generate");
    expect(getAuthIntent("/login").returnTo).toBe("/dashboard");
    expect(buildAuthUrl("/register")).toBe("/register");
    expect(buildAuthUrl("/login")).toBe("/login");
  });

  it("does not turn implicit auth defaults into cross-link destinations", () => {
    const plainLogin = getAuthIntent("/login");
    const plainRegister = getAuthIntent("/register");

    expect(getExplicitAuthDestination("/login")).toBeNull();
    expect(getExplicitAuthDestination("/register")).toBeNull();
    expect(getAuthCrossLinkDestination("/login", plainLogin)).toBeUndefined();
    expect(getAuthCrossLinkDestination("/register", plainRegister)).toBeUndefined();

    const registerUrl = buildAuthUrl("/register", {
      returnTo: getAuthCrossLinkDestination("/login", plainLogin),
    });
    expect(registerUrl).toBe("/register");
    expect(getAuthIntent(registerUrl).returnTo).toBe("/generate");

    const loginUrl = buildAuthUrl("/login", {
      returnTo: getAuthCrossLinkDestination("/register", plainRegister),
    });
    expect(loginUrl).toBe("/login");
    expect(getAuthIntent(loginUrl).returnTo).toBe("/dashboard");
  });

  it("keeps explicit destinations and billing intents when switching auth pages", () => {
    const explicitLogin = getAuthIntent(
      "/login?returnTo=%2Fjobs%2Fjob-1&plan=pro&interval=year",
    );
    expect(
      getAuthCrossLinkDestination(
        "/login?returnTo=%2Fjobs%2Fjob-1&plan=pro&interval=year",
        explicitLogin,
      ),
    ).toBe("/jobs/job-1");

    const billingOnlyLogin = getAuthIntent("/login?topup=topup_250");
    expect(getAuthCrossLinkDestination("/login?topup=topup_250", billingOnlyLogin)).toBe(
      "/pricing?topup=topup_250&continue=1",
    );
  });
});