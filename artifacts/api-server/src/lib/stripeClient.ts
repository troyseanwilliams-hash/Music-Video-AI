import Stripe from "stripe";
import type { StripeSync } from "stripe-replit-sync";
import { logger } from "./logger.js";

interface StripeConnectionSettings {
  publishable?: string;
  secret?: string;
}

interface StripeConnectionItem {
  settings: StripeConnectionSettings;
}

let loggedCredentialSource = false;

function logCredentialSource(source: string): void {
  if (loggedCredentialSource) return;
  loggedCredentialSource = true;
  logger.info({ source }, "Stripe credential source resolved");
}

async function getCredentials(): Promise<{
  publishableKey: string;
  secretKey: string;
}> {
  const isProduction = process.env["REPLIT_DEPLOYMENT"] === "1";

  // Development override: use sandbox keys when provided, so dev/test traffic
  // is isolated from the live Stripe account.
  if (!isProduction) {
    const sandboxSecret = process.env["STRIPE_SANDBOX_SECRET_KEY"];
    const sandboxPublishable = process.env["STRIPE_SANDBOX_PUBLISHABLE_KEY"];
    if (sandboxSecret && sandboxPublishable) {
      logCredentialSource("sandbox-secrets");
      return {
        publishableKey: sandboxPublishable,
        secretKey: sandboxSecret,
      };
    }
  }

  // Production override: when live Stripe keys are supplied as secrets, use them
  // directly instead of the Replit connector. This lets the deployed app run on a
  // Stripe account that the connector cannot bind.
  if (isProduction) {
    const overrideSecret = process.env["STRIPE_SECRET_KEY"];
    const overridePublishable = process.env["STRIPE_PUBLISHABLE_KEY"];
    if (overrideSecret && overridePublishable) {
      logCredentialSource("secrets");
      return {
        publishableKey: overridePublishable,
        secretKey: overrideSecret,
      };
    }
  }

  logCredentialSource(isProduction ? "connector (production)" : "connector");

  const hostname = process.env["REPLIT_CONNECTORS_HOSTNAME"];
  const xReplitToken = process.env["REPL_IDENTITY"]
    ? "repl " + process.env["REPL_IDENTITY"]
    : process.env["WEB_REPL_RENEWAL"]
      ? "depl " + process.env["WEB_REPL_RENEWAL"]
      : null;

  if (!hostname || !xReplitToken) {
    throw new Error(
      "Missing Replit environment variables. Ensure the Stripe integration is connected.",
    );
  }

  const targetEnvironment = isProduction ? "production" : "development";

  const url = new URL(`https://${hostname}/api/v2/connection`);
  url.searchParams.set("include_secrets", "true");
  url.searchParams.set("connector_names", "stripe");
  url.searchParams.set("environment", targetEnvironment);

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      X_REPLIT_TOKEN: xReplitToken,
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch Stripe credentials: ${response.status} ${response.statusText}`,
    );
  }

  const data = (await response.json()) as { items?: StripeConnectionItem[] };
  const settings = data.items?.[0]?.settings;

  if (!settings?.publishable || !settings?.secret) {
    throw new Error(
      `Stripe ${targetEnvironment} connection not found or missing credentials.`,
    );
  }

  return {
    publishableKey: settings.publishable,
    secretKey: settings.secret,
  };
}

export async function getUncachableStripeClient(): Promise<Stripe> {
  const { secretKey } = await getCredentials();
  return new Stripe(secretKey, {
    // Pin a current Stripe API version. Sent verbatim as the Stripe-Version
    // header at runtime; the installed SDK already accepts this literal.
    apiVersion: "2026-04-22.dahlia",
  });
}

export async function getStripePublishableKey(): Promise<string> {
  const { publishableKey } = await getCredentials();
  return publishableKey;
}

let stripeSync: StripeSync | null = null;

export async function getStripeSync(): Promise<StripeSync> {
  if (stripeSync) return stripeSync;

  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) {
    throw new Error("DATABASE_URL environment variable is required");
  }

  const { secretKey } = await getCredentials();
  const { StripeSync } = await import("stripe-replit-sync");

  stripeSync = new StripeSync({
    poolConfig: {
      connectionString: databaseUrl,
      max: 2,
    },
    stripeSecretKey: secretKey,
  });

  return stripeSync;
}

export async function initStripe(): Promise<void> {
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for Stripe initialization");
  }

  try {
    const { runMigrations } = await import("stripe-replit-sync");

    logger.info("Initializing Stripe schema");
    await runMigrations({ databaseUrl });
    logger.info("Stripe schema ready");

    const sync = await getStripeSync();

    if (process.env["NODE_ENV"] !== "production") {
      logger.info("Skipping managed Stripe webhook setup in development (dev domain is unreachable by Stripe)");
    } else {
      const replitDomain = process.env["REPLIT_DOMAINS"]?.split(",")[0];
      if (replitDomain) {
        const webhookUrl = `https://${replitDomain}/api/stripe/webhook`;
        logger.info({ webhookUrl }, "Setting up managed Stripe webhook");
        const result = await sync.findOrCreateManagedWebhook(webhookUrl);
        logger.info({ url: result?.url }, "Stripe webhook configured");
      } else {
        logger.warn("REPLIT_DOMAINS not set — skipping managed webhook setup");
      }
    }

    sync
      .syncBackfill()
      .then(() => logger.info("Stripe data backfill complete"))
      .catch((err: unknown) => {
        logger.error({ err }, "Stripe syncBackfill failed");
      });
  } catch (err) {
    logger.error({ err }, "Failed to initialize Stripe");
    throw err;
  }
}
