import Stripe from "stripe";
import { getUncachableStripeClient } from "./stripeClient.js";
import { logger } from "./logger.js";

type SuiteStripeMode = "dedicated" | "shared-fallback";

let loggedMode = false;

function dedicatedSecretKey(): string | null {
  const isProduction = process.env["REPLIT_DEPLOYMENT"] === "1";
  if (!isProduction) {
    return process.env["SUITE_STRIPE_SANDBOX_SECRET_KEY"] ?? null;
  }
  return process.env["SUITE_STRIPE_SECRET_KEY"] ?? null;
}

export function getSuiteStripeMode(): SuiteStripeMode {
  return dedicatedSecretKey() ? "dedicated" : "shared-fallback";
}

export async function getSuiteStripeClient(): Promise<Stripe> {
  const secretKey = dedicatedSecretKey();
  if (secretKey) {
    if (!loggedMode) {
      loggedMode = true;
      logger.info(
        { mode: "dedicated" },
        "AISync Suite billing uses its dedicated Stripe account",
      );
    }
    return new Stripe(secretKey, { apiVersion: "2026-04-22.dahlia" });
  }

  if (!loggedMode) {
    loggedMode = true;
    logger.warn(
      { mode: "shared-fallback" },
      "AISync Suite Stripe keys are not configured; using the shared Stripe account",
    );
  }
  return getUncachableStripeClient();
}

export function getSuiteWebhookSecret(): string | null {
  const isProduction = process.env["REPLIT_DEPLOYMENT"] === "1";
  return (
    (isProduction
      ? process.env["SUITE_STRIPE_WEBHOOK_SECRET"]
      : process.env["SUITE_STRIPE_SANDBOX_WEBHOOK_SECRET"]) ?? null
  );
}