import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AUTH_REGISTER_DEFAULT_DESTINATION,
  buildPricingIntent,
  getAuthCrossLinkDestination,
  getAuthIntent,
} from "../lib/authIntent";
import { buildAuthUrl } from "../lib/authIntent";

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));

describe("pricing to auth conversion", () => {
  it("sends an ordinary homepage registration to the generator, not the dashboard", () => {
    const loginIntent = getAuthIntent("/login");
    const registerLink = buildAuthUrl("/register", {
      returnTo: getAuthCrossLinkDestination("/login", loginIntent),
    });
    expect(registerLink).toBe("/register");
    expect(getAuthIntent(registerLink, AUTH_REGISTER_DEFAULT_DESTINATION).returnTo).toBe(
      "/generate",
    );
    expect(getAuthIntent("/login").returnTo).toBe("/dashboard");
  });

  it("preserves plan, interval, and referral through both auth screens", () => {
    const selection = buildAuthUrl("/register", {
      plan: "studio",
      interval: "month",
      referralCode: "friend-99",
      returnTo: buildPricingIntent("studio", "month", true),
      continueCheckout: true,
    });
    const registerIntent = getAuthIntent(selection);
    const loginLink = buildAuthUrl("/login", {
      returnTo: registerIntent.returnTo,
      plan: registerIntent.plan,
      interval: registerIntent.interval,
      referralCode: registerIntent.referralCode,
      continueCheckout: registerIntent.continueCheckout,
    });
    const loginIntent = getAuthIntent(loginLink);
    const returnedPricingIntent = getAuthIntent(loginIntent.returnTo);

    expect(returnedPricingIntent).toMatchObject({
      returnTo: "/pricing?plan=studio&interval=month&continue=1",
      plan: "studio",
      interval: "month",
      continueCheckout: true,
    });
    expect(loginIntent.referralCode).toBe("FRIEND-99");
  });

  it("preserves a logged-out top-up pack and returns with explicit continuation", () => {
    const registerLink = buildAuthUrl("/register", {
      topupId: "topup_250",
      referralCode: "friend-99",
      returnTo: buildPricingIntent(null, null, true, "topup_250"),
      continueCheckout: true,
    });
    const registerIntent = getAuthIntent(registerLink);
    const loginLink = buildAuthUrl("/login", {
      topupId: registerIntent.topupId,
      referralCode: registerIntent.referralCode,
      returnTo: registerIntent.returnTo,
      continueCheckout: registerIntent.continueCheckout,
    });
    const returnedPricing = getAuthIntent(getAuthIntent(loginLink).returnTo);

    expect(returnedPricing).toMatchObject({
      returnTo: "/pricing?topup=topup_250&continue=1",
      topupId: "topup_250",
      continueCheckout: true,
    });
  });

  it("requires a visible confirmation and never starts checkout during auth", () => {
    const pricingSource = fs.readFileSync(
      path.join(sourceDirectory, "../pages/pricing.tsx"),
      "utf8",
    );
    const registerSource = fs.readFileSync(
      path.join(sourceDirectory, "../pages/register.tsx"),
      "utf8",
    );
    const loginSource = fs.readFileSync(
      path.join(sourceDirectory, "../pages/login.tsx"),
      "utf8",
    );

    expect(pricingSource).toContain('data-testid="pricing-checkout-intent"');
    expect(pricingSource).toContain("Continue to checkout");
    expect(pricingSource).toContain("selectedTopupId");
    expect(pricingSource).toContain("data-selected={isSelectedTopupIntent ?");
    expect(pricingSource).toContain('purchaseType === "topup"');
    expect(pricingSource).toContain('topupId: purchaseType === "topup"');
    expect(pricingSource).toContain("you will not be charged automatically");
    expect(registerSource).toContain("setLocation(authIntent.returnTo)");
    expect(registerSource).not.toContain("createBillingCheckout");
    expect(loginSource).toContain("setLocation(authIntent.returnTo)");
    expect(loginSource).not.toContain("createBillingCheckout");
  });
});