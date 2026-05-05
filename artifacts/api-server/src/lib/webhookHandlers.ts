import Stripe from "stripe";
import { db } from "@workspace/db";
import { creditsTable, creditGrantsTable, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { getStripeSync, getUncachableStripeClient } from "./stripeClient";
import { logger } from "./logger";

function parseCreditsFromMetadata(
  metadata: Stripe.Metadata | null | undefined,
): number {
  if (!metadata) return 0;
  const raw = metadata["credits"];
  if (!raw) return 0;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

async function findUserByCustomerId(customerId: string) {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.stripeCustomerId, customerId))
    .limit(1);
  return user ?? null;
}

async function ensureCreditsRow(userId: string): Promise<void> {
  await db
    .insert(creditsTable)
    .values({ id: randomUUID(), userId })
    .onConflictDoNothing({ target: creditsTable.userId });
}

async function grantCredits(params: {
  userId: string;
  credits: number;
  source: "subscription" | "topup" | "admin";
  stripeEventId: string;
  stripeInvoiceId?: string | null;
  stripeCheckoutSessionId?: string | null;
  stripePriceId?: string | null;
}): Promise<{ granted: boolean; reason?: string }> {
  if (params.credits <= 0) {
    return { granted: false, reason: "no credits to grant" };
  }

  await ensureCreditsRow(params.userId);

  // Defense-in-depth: pre-check for an existing grant on the same invoice or
  // checkout session even if the stripe_event_id differs (e.g. Stripe fires
  // two distinct events for the same payment).
  if (params.stripeInvoiceId) {
    const [existing] = await db
      .select({ id: creditGrantsTable.id })
      .from(creditGrantsTable)
      .where(eq(creditGrantsTable.stripeInvoiceId, params.stripeInvoiceId))
      .limit(1);
    if (existing) return { granted: false, reason: "duplicate invoice" };
  }
  if (params.stripeCheckoutSessionId) {
    const [existing] = await db
      .select({ id: creditGrantsTable.id })
      .from(creditGrantsTable)
      .where(
        eq(
          creditGrantsTable.stripeCheckoutSessionId,
          params.stripeCheckoutSessionId,
        ),
      )
      .limit(1);
    if (existing) return { granted: false, reason: "duplicate checkout session" };
  }

  try {
    const [grant] = await db
      .insert(creditGrantsTable)
      .values({
        id: randomUUID(),
        userId: params.userId,
        source: params.source,
        creditsGranted: params.credits,
        stripeEventId: params.stripeEventId,
        stripeInvoiceId: params.stripeInvoiceId ?? null,
        stripeCheckoutSessionId: params.stripeCheckoutSessionId ?? null,
        stripePriceId: params.stripePriceId ?? null,
      })
      .onConflictDoNothing({ target: creditGrantsTable.stripeEventId })
      .returning();

    if (!grant) {
      return { granted: false, reason: "duplicate event" };
    }

    await db
      .update(creditsTable)
      .set({
        creditsRemaining: sql`${creditsTable.creditsRemaining} + ${params.credits}`,
      })
      .where(eq(creditsTable.userId, params.userId));

    logger.info(
      {
        userId: params.userId,
        credits: params.credits,
        source: params.source,
        stripeEventId: params.stripeEventId,
      },
      "Granted credits",
    );

    return { granted: true };
  } catch (err) {
    logger.error({ err, params }, "Failed to grant credits");
    return { granted: false, reason: "error" };
  }
}

async function handleInvoicePaid(
  event: Stripe.Event,
  invoice: Stripe.Invoice,
): Promise<void> {
  const customerId =
    typeof invoice.customer === "string"
      ? invoice.customer
      : invoice.customer?.id;
  if (!customerId) return;

  const user = await findUserByCustomerId(customerId);
  if (!user) {
    logger.warn(
      { customerId, invoiceId: invoice.id },
      "invoice.paid: no user matched stripe_customer_id",
    );
    return;
  }

  // Newer Stripe API versions (2025-08-27.basil and later) replaced
  // `line.price` with `line.pricing.price_details.price` (an ID-only string).
  // Older versions still surface the expanded `price` object. Support both.
  type LegacyLine = Stripe.InvoiceLineItem & { price?: Stripe.Price | null };
  type ModernPricing = {
    price_details?: { price?: string | null } | null;
  } | null;

  const stripe = await getUncachableStripeClient();
  const priceCache = new Map<string, Stripe.Price>();
  const resolvePrice = async (
    line: Stripe.InvoiceLineItem,
  ): Promise<Stripe.Price | null> => {
    const legacy = (line as LegacyLine).price ?? null;
    if (legacy) return legacy;
    const modern = (line as { pricing?: ModernPricing }).pricing;
    const priceId = modern?.price_details?.price ?? null;
    if (!priceId) return null;
    const cached = priceCache.get(priceId);
    if (cached) return cached;
    const fetched = await stripe.prices.retrieve(priceId);
    priceCache.set(priceId, fetched);
    return fetched;
  };

  let totalCredits = 0;
  let firstPriceId: string | null = null;
  for (const line of invoice.lines.data ?? []) {
    const price = await resolvePrice(line);
    if (!price) continue;
    if (!firstPriceId) firstPriceId = price.id;
    const credits = parseCreditsFromMetadata(price.metadata);
    if (credits > 0) {
      const quantity = line.quantity ?? 1;
      totalCredits += credits * quantity;
    }
  }

  if (totalCredits === 0) {
    logger.info(
      { invoiceId: invoice.id },
      "invoice.paid: no credit metadata found on line items",
    );
    return;
  }

  await grantCredits({
    userId: user.id,
    credits: totalCredits,
    source: "subscription",
    stripeEventId: event.id,
    stripeInvoiceId: invoice.id ?? null,
    stripePriceId: firstPriceId,
  });

  if (user.subscriptionStatus !== "active") {
    await db
      .update(usersTable)
      .set({ subscriptionStatus: "active" })
      .where(eq(usersTable.id, user.id));
  }
}

async function handleCheckoutCompleted(
  event: Stripe.Event,
  session: Stripe.Checkout.Session,
): Promise<void> {
  if (session.mode !== "payment") return;

  const customerId =
    typeof session.customer === "string"
      ? session.customer
      : session.customer?.id;
  if (!customerId) return;

  const user = await findUserByCustomerId(customerId);
  if (!user) {
    logger.warn(
      { customerId, sessionId: session.id },
      "checkout.session.completed: no user matched",
    );
    return;
  }

  const stripe = await getUncachableStripeClient();
  if (!session.id) return;
  const fullSession = await stripe.checkout.sessions.retrieve(session.id, {
    expand: ["line_items.data.price"],
  });

  let totalCredits = 0;
  let firstPriceId: string | null = null;
  for (const item of fullSession.line_items?.data ?? []) {
    const price = item.price;
    if (!price) continue;
    if (!firstPriceId) firstPriceId = price.id;
    const credits = parseCreditsFromMetadata(price.metadata);
    if (credits > 0) {
      const quantity = item.quantity ?? 1;
      totalCredits += credits * quantity;
    }
  }

  if (totalCredits === 0) return;

  await grantCredits({
    userId: user.id,
    credits: totalCredits,
    source: "topup",
    stripeEventId: event.id,
    stripeCheckoutSessionId: session.id ?? null,
    stripePriceId: firstPriceId,
  });
}

async function handleSubscriptionUpdated(
  subscription: Stripe.Subscription,
): Promise<void> {
  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer?.id;
  if (!customerId) return;

  const user = await findUserByCustomerId(customerId);
  if (!user) return;

  const isActive =
    subscription.status === "active" || subscription.status === "trialing";

  await db
    .update(usersTable)
    .set({
      stripeSubscriptionId: subscription.id,
      subscriptionStatus: isActive
        ? "active"
        : subscription.status === "canceled"
          ? "cancelled"
          : subscription.status,
    })
    .where(eq(usersTable.id, user.id));
}

export class WebhookHandlers {
  static async processWebhook(
    payload: Buffer,
    signature: string,
  ): Promise<void> {
    if (!Buffer.isBuffer(payload)) {
      throw new Error(
        "STRIPE WEBHOOK ERROR: Payload must be a Buffer. " +
          "Webhook route must be registered BEFORE express.json().",
      );
    }

    const sync = await getStripeSync();
    await sync.processWebhook(payload, signature);

    let event: Stripe.Event;
    try {
      event = JSON.parse(payload.toString("utf8")) as Stripe.Event;
    } catch (err) {
      logger.warn({ err }, "Failed to parse webhook payload for billing logic");
      return;
    }

    try {
      switch (event.type) {
        case "invoice.paid":
          // NOTE: do NOT also handle "invoice.payment_succeeded" — Stripe fires
          // both events for the same paid invoice with different event IDs, and
          // event-id idempotency alone would let us double-grant credits.
          await handleInvoicePaid(event, event.data.object as Stripe.Invoice);
          break;
        case "checkout.session.completed":
          await handleCheckoutCompleted(
            event,
            event.data.object as Stripe.Checkout.Session,
          );
          break;
        case "customer.subscription.created":
        case "customer.subscription.updated":
        case "customer.subscription.deleted":
          await handleSubscriptionUpdated(
            event.data.object as Stripe.Subscription,
          );
          break;
        default:
          break;
      }
    } catch (err) {
      logger.error(
        { err, eventType: event.type, eventId: event.id },
        "Billing webhook handler failed",
      );
    }
  }
}
