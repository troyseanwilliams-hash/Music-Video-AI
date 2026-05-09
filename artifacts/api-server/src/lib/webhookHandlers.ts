import Stripe from "stripe";
import { db } from "@workspace/db";
import { creditsTable, creditGrantsTable, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { getStripeSync, getUncachableStripeClient } from "./stripeClient.js";
import { logger } from "./logger.js";

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

    const bucketColumn =
      params.source === "topup"
        ? creditsTable.topupCredits
        : creditsTable.subscriptionCredits;

    await db
      .update(creditsTable)
      .set({
        creditsRemaining: sql`${creditsTable.creditsRemaining} + ${params.credits}`,
        [params.source === "topup" ? "topupCredits" : "subscriptionCredits"]:
          sql`${bucketColumn} + ${params.credits}`,
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

/**
 * Reset the subscription credit bucket to the plan's allotment.
 *
 * Called on every invoice.paid for a recurring subscription line item.
 * Unlike grantCredits (which adds to the existing bucket), this function
 * *replaces* subscriptionCredits with the new plan amount so unused plan
 * credits from the previous cycle do not roll over.  topupCredits are never
 * touched.  creditsRemaining is recomputed as subscriptionCredits + topupCredits.
 *
 * The grant is still written to credit_grants for a full audit trail, and the
 * same idempotency guards (stripe_event_id / stripe_invoice_id uniqueness) are
 * applied so replaying events is always safe.
 */
async function resetSubscriptionCredits(params: {
  userId: string;
  credits: number;
  stripeEventId: string;
  stripeInvoiceId?: string | null;
  stripePriceId?: string | null;
}): Promise<{ granted: boolean; reason?: string }> {
  if (params.credits <= 0) {
    return { granted: false, reason: "no credits to grant" };
  }

  await ensureCreditsRow(params.userId);

  if (params.stripeInvoiceId) {
    const [existing] = await db
      .select({ id: creditGrantsTable.id })
      .from(creditGrantsTable)
      .where(eq(creditGrantsTable.stripeInvoiceId, params.stripeInvoiceId))
      .limit(1);
    if (existing) return { granted: false, reason: "duplicate invoice" };
  }

  try {
    // Wrap the ledger insert and balance update in a single transaction so
    // that a partial failure (insert succeeds, update fails) never leaves a
    // stale ledger row that would block subsequent idempotent retries.
    const granted = await db.transaction(async (tx) => {
      const [grant] = await tx
        .insert(creditGrantsTable)
        .values({
          id: randomUUID(),
          userId: params.userId,
          source: "subscription",
          creditsGranted: params.credits,
          stripeEventId: params.stripeEventId,
          stripeInvoiceId: params.stripeInvoiceId ?? null,
          stripeCheckoutSessionId: null,
          stripePriceId: params.stripePriceId ?? null,
        })
        .onConflictDoNothing({ target: creditGrantsTable.stripeEventId })
        .returning();

      if (!grant) return false;

      // Replace subscriptionCredits with the plan amount; add topupCredits on
      // top so creditsRemaining stays consistent without touching the top-up
      // bucket.
      await tx
        .update(creditsTable)
        .set({
          subscriptionCredits: params.credits,
          creditsRemaining: sql`${params.credits} + ${creditsTable.topupCredits}`,
        })
        .where(eq(creditsTable.userId, params.userId));

      return true;
    });

    if (!granted) {
      return { granted: false, reason: "duplicate event" };
    }

    logger.info(
      {
        userId: params.userId,
        credits: params.credits,
        stripeEventId: params.stripeEventId,
      },
      "Reset subscription credits for renewal",
    );

    return { granted: true };
  } catch (err) {
    logger.error({ err, params }, "Failed to reset subscription credits");
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

  // Stripe API versions before 2025-08-27.basil used top-level `line.type`
  // and `line.proration` booleans.  The 2025-08-27.basil+ API moved these
  // into `line.parent.type` and `line.parent.<type>_item_details.proration`.
  // We support both shapes via type-cast helpers so the filter logic reads
  // cleanly regardless of which API version the webhook payload came from.
  type LegacyLineExtra = { type?: string; proration?: boolean };
  type ModernParent = {
    type?: string;
    subscription_item_details?: { proration?: boolean } | null;
    invoice_item_details?: { proration?: boolean } | null;
  } | null;

  const isSubscriptionLine = (line: Stripe.InvoiceLineItem): boolean => {
    // Modern API: parent.type === 'subscription_item_details'
    const parent = (line as unknown as { parent?: ModernParent }).parent;
    if (parent?.type) return parent.type === "subscription_item_details";
    // Legacy API: line.type === 'subscription'
    return (line as LegacyLineExtra).type === "subscription";
  };

  const isProrationLine = (line: Stripe.InvoiceLineItem): boolean => {
    // Modern API: proration flag lives inside the parent details object
    const parent = (line as unknown as { parent?: ModernParent }).parent;
    if (parent?.subscription_item_details) {
      return Boolean(parent.subscription_item_details.proration);
    }
    if (parent?.invoice_item_details) {
      return Boolean(parent.invoice_item_details.proration);
    }
    // Legacy API: top-level proration boolean
    return Boolean((line as LegacyLineExtra).proration);
  };

  // Resolve the subscription ID from the invoice.
  // Modern API: invoice.parent.subscription_details.subscription
  // Legacy API: invoice.subscription
  const resolveSubscriptionId = (inv: Stripe.Invoice): string | null => {
    type ModernInvoiceParent = {
      subscription_details?: { subscription?: string | { id: string } | null } | null;
    } | null;
    const parent = (inv as unknown as { parent?: ModernInvoiceParent }).parent;
    const fromParent = parent?.subscription_details?.subscription;
    if (fromParent) {
      return typeof fromParent === "string" ? fromParent : fromParent.id;
    }
    // Legacy field
    const legacy = (inv as unknown as { subscription?: string | { id: string } | null })
      .subscription;
    if (!legacy) return null;
    return typeof legacy === "string" ? legacy : legacy.id;
  };

  // Determine the subscription credit allotment for this invoice.
  //
  // We only look at non-proration subscription lines because:
  // - Standard renewal invoices have exactly one non-proration subscription
  //   line for the new billing period — that is the canonical plan allotment.
  // - Mid-cycle upgrade/downgrade invoices contain ONLY proration lines
  //   (credit for unused time on old plan + charge for remaining time on new
  //   plan), so filtering them out leaves nothing; we then fall back to
  //   retrieving the subscription's current items to get the new plan amount.
  //
  // This prevents double-counting proration lines and ensures the bucket is
  // always set to exactly the new plan's full-period credit allotment.
  let totalCredits = 0;
  let firstPriceId: string | null = null;

  for (const line of invoice.lines.data ?? []) {
    // Skip proration lines and non-subscription (one-time) lines.
    if (!isSubscriptionLine(line)) continue;
    if (isProrationLine(line)) continue;

    const price = await resolvePrice(line);
    if (!price) continue;
    if (!firstPriceId) firstPriceId = price.id;
    const credits = parseCreditsFromMetadata(price.metadata);
    if (credits > 0) {
      // Subscription lines always have quantity 1 at the plan level, but
      // respect the field in case a plan is configured differently.
      const quantity = line.quantity ?? 1;
      totalCredits += credits * quantity;
    }
  }

  // Fallback: all invoice lines were proration lines (mid-cycle
  // upgrade/downgrade).  Retrieve the subscription's current items to obtain
  // the new plan's credit allotment.
  if (totalCredits === 0) {
    const subscriptionId = resolveSubscriptionId(invoice);

    if (subscriptionId) {
      try {
        const sub = await stripe.subscriptions.retrieve(subscriptionId, {
          expand: ["items.data.price"],
        });
        for (const item of sub.items.data) {
          const price = item.price;
          if (!price) continue;
          if (!firstPriceId) firstPriceId = price.id;
          const credits = parseCreditsFromMetadata(price.metadata);
          if (credits > 0) {
            totalCredits += credits * (item.quantity ?? 1);
          }
        }
      } catch (err) {
        logger.error(
          { err, subscriptionId, invoiceId: invoice.id },
          "invoice.paid: failed to retrieve subscription for proration-only invoice",
        );
      }
    }
  }

  if (totalCredits === 0) {
    logger.info(
      { invoiceId: invoice.id },
      "invoice.paid: no credit metadata found on line items or subscription",
    );
    return;
  }

  // Use reset (replace) semantics for subscription credits so unused plan
  // credits from the previous cycle do not roll over.  Top-up credits are
  // preserved automatically by resetSubscriptionCredits.
  await resetSubscriptionCredits({
    userId: user.id,
    credits: totalCredits,
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

/**
 * Replay recent Stripe events that may have been missed during a server restart.
 *
 * Problem: When the api-server restarts it re-registers (or re-finds) the managed
 * webhook endpoint. Any event that Stripe delivered in the gap between the old
 * process dying and the new one registering its endpoint is never pushed to us,
 * so credits would not be granted without a manual retry.
 *
 * Solution: On every startup we list the last `lookbackSeconds` worth of Stripe
 * events for every relevant event type (using full auto-pagination so >100 events
 * are never silently skipped), sort everything chronologically oldest-first, and
 * then process them in order through the same handlers used by the live webhook.
 *
 * Processing is fully idempotent — `grantCredits` does pre-checks and relies on
 * unique DB constraints on `stripe_event_id`, `stripe_invoice_id`, and
 * `stripe_checkout_session_id`, so re-processing an already-handled event is
 * always a safe no-op.
 *
 * See scripts/src/test-stripe-replay.ts for a runnable verification that proves
 * an event missed during a restart still results in the correct row in
 * `credit_grants` and the right balance in `credits.credits_remaining`.
 */
export async function replayRecentStripeEvents(
  lookbackSeconds = 1800,
): Promise<void> {
  const RELEVANT_EVENT_TYPES = [
    "checkout.session.completed",
    "invoice.paid",
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
  ] as const;

  const stripe = await getUncachableStripeClient();
  const since = Math.floor(Date.now() / 1000) - lookbackSeconds;

  logger.info(
    { lookbackSeconds, since },
    "Replaying recent Stripe events to recover any missed during restart",
  );

  // Collect ALL events across all types using auto-pagination so that windows
  // with more than 100 events per type are never silently truncated.
  const allEvents: Stripe.Event[] = [];
  for (const type of RELEVANT_EVENT_TYPES) {
    try {
      for await (const event of stripe.events.list({
        type,
        created: { gte: since },
        limit: 100,
      })) {
        allEvents.push(event);
      }
    } catch (err) {
      logger.error(
        { err, eventType: type },
        "Failed to list Stripe events for replay — skipping this type",
      );
    }
  }

  // Sort oldest-first so subscription state mutations are applied in the
  // correct order (e.g. created → updated → deleted, not the reverse).
  allEvents.sort((a, b) => a.created - b.created);

  let replayed = 0;
  const failedEvents: Array<{ id: string; type: string }> = [];

  for (const event of allEvents) {
    try {
      switch (event.type) {
        case "invoice.paid":
          await handleInvoicePaid(event, event.data.object as Stripe.Invoice);
          replayed++;
          break;
        case "checkout.session.completed":
          await handleCheckoutCompleted(
            event,
            event.data.object as Stripe.Checkout.Session,
          );
          replayed++;
          break;
        case "customer.subscription.created":
        case "customer.subscription.updated":
        case "customer.subscription.deleted":
          await handleSubscriptionUpdated(
            event.data.object as Stripe.Subscription,
          );
          replayed++;
          break;
      }
    } catch (err) {
      failedEvents.push({ id: event.id, type: event.type });
      logger.error(
        { err, eventType: event.type, eventId: event.id },
        "Error replaying Stripe event on startup — continuing",
      );
    }
  }

  if (failedEvents.length > 0) {
    logger.error(
      {
        replayed,
        failed: failedEvents.length,
        total: allEvents.length,
        failedEventIds: failedEvents.map((e) => e.id),
        failedEventTypes: failedEvents.map((e) => e.type),
        failedEvents,
      },
      "Stripe event replay finished with errors — some credits may need manual review",
    );

    await notifyReplayFailures(failedEvents);
  } else {
    logger.info(
      { replayed, total: allEvents.length },
      "Stripe event replay complete",
    );
  }
}

/**
 * Send an admin alert when Stripe event replay failures meet or exceed the
 * configured threshold.
 *
 * Reads two optional environment variables:
 *   STRIPE_REPLAY_ALERT_SLACK_WEBHOOK  — incoming webhook URL to post to
 *   STRIPE_REPLAY_ALERT_THRESHOLD      — minimum failure count that triggers
 *                                        the alert (defaults to 1)
 *
 * If the webhook URL is not set the function is a no-op (the structured log
 * emitted by the caller is still the primary signal).
 */
async function notifyReplayFailures(
  failedEvents: Array<{ id: string; type: string }>,
): Promise<void> {
  const webhookUrl = process.env["STRIPE_REPLAY_ALERT_SLACK_WEBHOOK"];
  if (!webhookUrl) return;

  const rawThreshold = process.env["STRIPE_REPLAY_ALERT_THRESHOLD"];
  let threshold = 1;
  if (rawThreshold !== undefined && rawThreshold !== "") {
    const parsed = parseInt(rawThreshold, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      logger.warn(
        { rawThreshold },
        "STRIPE_REPLAY_ALERT_THRESHOLD is not a valid positive integer — defaulting to 1",
      );
    } else {
      threshold = parsed;
    }
  }
  if (failedEvents.length < threshold) return;

  const summary = failedEvents
    .map((e) => `• \`${e.id}\` (${e.type})`)
    .join("\n");

  const body = JSON.stringify({
    text: [
      `*Stripe event replay alert* — ${failedEvents.length} event(s) failed during server startup.`,
      "These events may need manual review to ensure credits were granted correctly.",
      "",
      "*Failed events:*",
      summary,
    ].join("\n"),
  });

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    if (!response.ok) {
      logger.warn(
        { status: response.status },
        "Stripe replay alert: Slack webhook returned non-OK status",
      );
    } else {
      logger.info(
        { failedCount: failedEvents.length },
        "Stripe replay alert sent to Slack",
      );
    }
  } catch (err) {
    logger.error({ err }, "Stripe replay alert: failed to post to Slack webhook");
  }
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
