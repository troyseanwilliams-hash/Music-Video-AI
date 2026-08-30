import Stripe from "stripe";
import { db } from "@workspace/db";
import {
  creditsTable,
  creditGrantsTable,
  usersTable,
  suiteLinksTable,
  suiteSubscriptionsTable,
  suiteOutboxEventsTable,
} from "@workspace/db";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { getStripeSync, getUncachableStripeClient } from "./stripeClient.js";
import {
  getSuiteStripeClient,
  getSuiteWebhookSecret,
} from "./suiteStripeClient.js";
import { logger } from "./logger.js";
import { notifyPayment } from "./notifications.js";
import {
  enqueueSuiteOutboxEvent,
  parseAipodCredits,
  isSuiteLookupKey,
} from "../routes/suite.js";

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
  const [directUser] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.stripeCustomerId, customerId))
    .limit(1);
  if (directUser) return directUser;

  const [suiteLink] = await db
    .select({ aibeatUserId: suiteLinksTable.aibeatUserId })
    .from(suiteLinksTable)
    .where(eq(suiteLinksTable.stripeCustomerId, customerId))
    .limit(1);
  if (!suiteLink) return null;

  const [suiteUser] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, suiteLink.aibeatUserId))
    .limit(1);
  return suiteUser ?? null;
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
  subscriptionId: string;
  observedUserSubscriptionId: string | null;
  observedCurrentSubscriptionIsNonterminal: boolean;
}): Promise<{ granted: boolean; reason?: string }> {
  if (params.credits <= 0) {
    return { granted: false, reason: "no credits to grant" };
  }

  try {
    const granted = await db.transaction(async (tx) => {
      // All invoice grants for a user serialize on the user row. Re-read the
      // authority state only after taking the lock so an older direct invoice
      // cannot race a newer Suite grant and overwrite its balance.
      await tx.execute(
        sql`select ${usersTable.id} from ${usersTable} where ${usersTable.id} = ${params.userId} for update`,
      );
      const [lockedUser] = await tx
        .select({
          stripeSubscriptionId: usersTable.stripeSubscriptionId,
        })
        .from(usersTable)
        .where(eq(usersTable.id, params.userId))
        .limit(1);
      if (!lockedUser) return "stale" as const;

      const [suiteAuthority] = await tx
        .select({
          subscriptionStatus: suiteLinksTable.subscriptionStatus,
          stripeSubscriptionId: suiteLinksTable.stripeSubscriptionId,
        })
        .from(suiteLinksTable)
        .where(eq(suiteLinksTable.aibeatUserId, params.userId))
        .limit(1);
      if (
        suiteAuthority?.stripeSubscriptionId &&
        suiteAuthority.stripeSubscriptionId !== params.subscriptionId &&
        (suiteAuthority.subscriptionStatus === "active" ||
          suiteAuthority.subscriptionStatus === "past_due")
      ) {
        return "stale" as const;
      }

      if (lockedUser.stripeSubscriptionId !== params.subscriptionId) {
        // If the pointer changed after the event began, a newer webhook won.
        if (
          lockedUser.stripeSubscriptionId !==
          params.observedUserSubscriptionId
        ) {
          return "stale" as const;
        }
        // A different nonterminal subscription remains authoritative.
        if (params.observedCurrentSubscriptionIsNonterminal) {
          return "stale" as const;
        }
      }

      await tx
        .insert(creditsTable)
        .values({ id: randomUUID(), userId: params.userId })
        .onConflictDoNothing({ target: creditsTable.userId });

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
        .onConflictDoNothing()
        .returning();

      if (!grant) return "duplicate" as const;

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

      await tx
        .update(usersTable)
        .set({
          subscriptionStatus: "active",
          stripeSubscriptionId: params.subscriptionId,
          billingCheckoutPendingUntil: null,
        })
        .where(eq(usersTable.id, params.userId));

      return "granted" as const;
    });

    if (granted !== "granted") {
      return { granted: false, reason: granted };
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

/**
 * Stripe 2025-08-27.basil+ moved the subscription reference under
 * invoice.parent.subscription_details. Accept both that shape and the legacy
 * top-level invoice.subscription field for webhook/replay compatibility.
 */
export function resolveSubscriptionId(invoice: Stripe.Invoice): string | null {
  type ModernInvoiceParent = {
    subscription_details?: {
      subscription?: string | { id: string } | null;
    } | null;
  } | null;
  const parent = (invoice as unknown as { parent?: ModernInvoiceParent }).parent;
  const fromParent = parent?.subscription_details?.subscription;
  if (fromParent) {
    return typeof fromParent === "string" ? fromParent : fromParent.id;
  }
  const legacy = (
    invoice as unknown as {
      subscription?: string | { id: string } | null;
    }
  ).subscription;
  if (!legacy) return null;
  return typeof legacy === "string" ? legacy : legacy.id;
}

export async function handleInvoicePaid(
  event: Stripe.Event,
  invoice: Stripe.Invoice,
  stripeOverride?: Stripe,
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

  const stripe = stripeOverride ?? (await getUncachableStripeClient());
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

  // ── Detect Suite vs generic subscription ──────────────────────────────────
  // Retrieve the resolved price to check its lookup_key.
  let resolvedLookupKey: string | null = null;
  let aipodCredits = 0;
  if (firstPriceId) {
    try {
      const resolvedPrice = await stripe.prices.retrieve(firstPriceId);
      resolvedLookupKey = resolvedPrice.lookup_key ?? null;
      aipodCredits = parseAipodCredits(resolvedPrice.metadata);
    } catch {
      // non-fatal
    }
  }

  const isSuite = isSuiteLookupKey(resolvedLookupKey);
  const subscriptionId = resolveSubscriptionId(invoice);
  if (!subscriptionId) {
    logger.warn(
      { invoiceId: invoice.id },
      "invoice.paid: subscription-backed invoice had no subscription ID",
    );
    return;
  }

  let liveSubscription: Stripe.Subscription;
  try {
    liveSubscription = await stripe.subscriptions.retrieve(subscriptionId);
  } catch (err) {
    logger.error(
      { err, invoiceId: invoice.id, subscriptionId },
      "invoice.paid: failed to verify live subscription authority",
    );
    throw err;
  }
  if (
    liveSubscription.status !== "active" &&
    liveSubscription.status !== "trialing"
  ) {
    logger.info(
      {
        invoiceId: invoice.id,
        subscriptionId,
        liveStatus: liveSubscription.status,
      },
      "Ignoring stale invoice for a non-active subscription",
    );
    return;
  }

  if (isSuite) {
    // ── Suite invoice.paid ─────────────────────────────────────────────────
    // Find the link associated with this subscription via subscription metadata.
    const linkId = liveSubscription.metadata?.["linkId"] ?? null;

    if (!linkId || !invoice.id || aipodCredits <= 0) {
      throw new Error(
        `Suite invoice ${invoice.id ?? "(missing id)"} is missing link or AIPod entitlement metadata`,
      );
    }

    // The AIBeat credit reset, Suite state, and AIPod outbox event are one
    // transaction. A duplicate invoice does not reset spent credits again, but
    // still repairs a missing outbox row from an interrupted older deployment.
    const suiteResult = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select ${usersTable.id} from ${usersTable} where ${usersTable.id} = ${user.id} for update`,
      );
      const [currentLink] = await tx
        .select({
          id: suiteLinksTable.id,
          subscriptionStatus: suiteLinksTable.subscriptionStatus,
          stripeSubscriptionId: suiteLinksTable.stripeSubscriptionId,
        })
        .from(suiteLinksTable)
        .where(
          and(
            eq(suiteLinksTable.id, linkId),
            eq(suiteLinksTable.aibeatUserId, user.id),
          ),
        )
        .limit(1);
      if (!currentLink) {
        return { stale: true, creditsReset: false };
      }
      if (
        currentLink.stripeSubscriptionId &&
        currentLink.stripeSubscriptionId !== subscriptionId &&
        (currentLink.subscriptionStatus === "active" ||
          currentLink.subscriptionStatus === "past_due")
      ) {
        return { stale: true, creditsReset: false };
      }

      await tx
        .insert(creditsTable)
        .values({ id: randomUUID(), userId: user.id })
        .onConflictDoNothing({ target: creditsTable.userId });

      const [grant] = await tx
        .insert(creditGrantsTable)
        .values({
          id: randomUUID(),
          userId: user.id,
          source: "subscription",
          creditsGranted: totalCredits,
          stripeEventId: event.id,
          stripeInvoiceId: invoice.id,
          stripeCheckoutSessionId: null,
          stripePriceId: firstPriceId,
        })
        .onConflictDoNothing()
        .returning({ id: creditGrantsTable.id });

      if (grant) {
        await tx
          .update(creditsTable)
          .set({
            subscriptionCredits: totalCredits,
            creditsRemaining: sql`${totalCredits} + ${creditsTable.topupCredits}`,
          })
          .where(eq(creditsTable.userId, user.id));
      }

      await tx
        .insert(suiteSubscriptionsTable)
        .values({
          id: randomUUID(),
          linkId,
          stripeSubscriptionId: subscriptionId ?? null,
          stripePriceId: firstPriceId,
          priceLookupKey: resolvedLookupKey,
          status: "active",
          aibeatCredits: totalCredits,
          aipodCredits,
        })
        .onConflictDoUpdate({
          target: suiteSubscriptionsTable.linkId,
          set: {
            stripeSubscriptionId: subscriptionId ?? null,
            stripePriceId: firstPriceId,
            priceLookupKey: resolvedLookupKey,
            status: "active",
            aibeatCredits: totalCredits,
            aipodCredits,
          },
        });

      await tx
        .insert(suiteOutboxEventsTable)
        .values({
          id: randomUUID(),
          linkId,
          eventKey: `invoice.${invoice.id}.credits.grant`,
          eventType: "credits.grant",
          payload: JSON.stringify({
            invoiceId: invoice.id,
            subscriptionId,
            aipodCredits,
            aibeatCredits: totalCredits,
            priceLookupKey: resolvedLookupKey,
          }),
        })
        .onConflictDoNothing({ target: suiteOutboxEventsTable.eventKey });

      await tx
        .update(suiteLinksTable)
        .set({
          subscriptionStatus: "active",
          stripeSubscriptionId: subscriptionId,
          checkoutPendingUntil: null,
        })
        .where(eq(suiteLinksTable.id, linkId));

      await tx
        .update(usersTable)
        .set({
          subscriptionStatus: "active",
          stripeSubscriptionId: subscriptionId,
        })
        .where(eq(usersTable.id, user.id));

      return { stale: false, creditsReset: Boolean(grant) };
    });

    if (suiteResult.stale) {
      logger.info(
        { invoiceId: invoice.id, subscriptionId, linkId },
        "Ignoring stale Suite invoice after a newer subscription became authoritative",
      );
      return;
    }

    if (suiteResult.creditsReset) {
      notifyPayment({
        email: user.email,
        kind: "subscription",
        amountUsd: (invoice.amount_paid ?? 0) / 100,
        detail: `Suite ${resolvedLookupKey}: ${totalCredits} AIBeat + ${aipodCredits} AIPod credits`,
      });
    }

    logger.info(
      {
        userId: user.id,
        linkId,
        totalCredits,
        aipodCredits,
        invoiceId: invoice.id,
        creditsReset: suiteResult.creditsReset,
      },
      "Suite invoice.paid processed",
    );
    return;
  }

  // ── Generic (non-Suite) subscription ─────────────────────────────────────

  let observedCurrentSubscriptionIsNonterminal = false;
  if (
    user.stripeSubscriptionId &&
    user.stripeSubscriptionId !== subscriptionId
  ) {
    try {
      const currentSubscription = await stripe.subscriptions.retrieve(
        user.stripeSubscriptionId,
      );
      observedCurrentSubscriptionIsNonterminal =
        currentSubscription.status !== "canceled" &&
        currentSubscription.status !== "incomplete_expired";
    } catch (err) {
      logger.error(
        {
          err,
          invoiceId: invoice.id,
          currentSubscriptionId: user.stripeSubscriptionId,
        },
        "invoice.paid: failed to verify current subscription authority",
      );
      throw err;
    }
  }

  // Use reset (replace) semantics for subscription credits so unused plan
  // credits from the previous cycle do not roll over.  Top-up credits are
  // preserved automatically by resetSubscriptionCredits.
  const resetResult = await resetSubscriptionCredits({
    userId: user.id,
    credits: totalCredits,
    stripeEventId: event.id,
    stripeInvoiceId: invoice.id ?? null,
    stripePriceId: firstPriceId,
    subscriptionId,
    observedUserSubscriptionId: user.stripeSubscriptionId ?? null,
    observedCurrentSubscriptionIsNonterminal,
  });

  if (!resetResult.granted) {
    logger.info(
      { invoiceId: invoice.id, subscriptionId, reason: resetResult.reason },
      "invoice.paid did not change generic subscription credits",
    );
    return;
  }

  notifyPayment({
    email: user.email,
    kind: "subscription",
    amountUsd: (invoice.amount_paid ?? 0) / 100,
    detail: `${totalCredits} credits`,
  });
}

async function handleCheckoutCompleted(
  event: Stripe.Event,
  session: Stripe.Checkout.Session,
  stripeOverride?: Stripe,
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

  const stripe = stripeOverride ?? (await getUncachableStripeClient());
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

  notifyPayment({
    email: user.email,
    kind: "topup",
    amountUsd: (fullSession.amount_total ?? 0) / 100,
    detail: `${totalCredits} credits`,
  });
}

export async function handleSubscriptionUpdated(
  stripeEventId: string,
  subscription: Stripe.Subscription,
  stripeOverride?: Stripe,
): Promise<void> {
  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer?.id;
  if (!customerId) return;

  const user = await findUserByCustomerId(customerId);
  if (!user) return;

  const stripe = stripeOverride ?? (await getUncachableStripeClient());
  try {
    // Webhook payloads are historical snapshots. Always base entitlement
    // decisions on the provider's current subscription state.
    subscription = await stripe.subscriptions.retrieve(subscription.id);
  } catch (err) {
    logger.error(
      { err, subscriptionId: subscription.id, userId: user.id },
      "Failed to verify live subscription lifecycle state",
    );
    throw err;
  }

  const isActive =
    subscription.status === "active" || subscription.status === "trialing";

  // ── Suite subscription lifecycle ──────────────────────────────────────────
  const linkId: string | null = subscription.metadata?.["linkId"] ?? null;
  const item = subscription.items.data[0];
  const resolvedLookupKey = item?.price?.lookup_key ?? null;
  const isSuite = isSuiteLookupKey(resolvedLookupKey);

  if (isSuite && !linkId) {
    logger.error(
      { subscriptionId: subscription.id, userId: user.id, resolvedLookupKey },
      "Ignoring Suite subscription lifecycle event without link metadata",
    );
    return;
  }

  if (isSuite && linkId) {
    const suiteStatus =
      subscription.status === "active" || subscription.status === "trialing"
        ? "active"
        : subscription.status === "canceled"
          ? "cancelled"
          : subscription.status === "past_due"
            ? "past_due"
            : "none";

    const cancelAtPeriodEnd = subscription.cancel_at_period_end;
    // Get current_period_end from item (new API) or top-level (legacy)
    const itemEnd = item
      ? (item as Stripe.SubscriptionItem & { current_period_end?: number }).current_period_end
      : undefined;
    const legacyEnd = (subscription as Stripe.Subscription & { current_period_end?: number }).current_period_end;
    const periodEnd = typeof itemEnd === "number" ? itemEnd : legacyEnd;
    const currentPeriodEnd = typeof periodEnd === "number" ? new Date(periodEnd * 1000) : null;
    let observedCurrentSubscriptionIsNonterminal = false;
    // A dedicated Suite Stripe account cannot retrieve a standalone product
    // subscription ID. Direct checkout is already excluded before Suite
    // checkout, so Suite lifecycle events only fence against Suite link state.
    if (
      !stripeOverride &&
      user.stripeSubscriptionId &&
      user.stripeSubscriptionId !== subscription.id
    ) {
      const currentUserSubscription = await stripe.subscriptions.retrieve(
        user.stripeSubscriptionId,
      );
      observedCurrentSubscriptionIsNonterminal =
        currentUserSubscription.status !== "canceled" &&
        currentUserSubscription.status !== "incomplete_expired";
    }

    const lifecycleResult = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select ${usersTable.id} from ${usersTable} where ${usersTable.id} = ${user.id} for update`,
      );
      const [lockedUser] = await tx
        .select({ stripeSubscriptionId: usersTable.stripeSubscriptionId })
        .from(usersTable)
        .where(eq(usersTable.id, user.id))
        .limit(1);
      const [currentLink] = await tx
        .select({
          id: suiteLinksTable.id,
          subscriptionStatus: suiteLinksTable.subscriptionStatus,
          stripeSubscriptionId: suiteLinksTable.stripeSubscriptionId,
        })
        .from(suiteLinksTable)
        .where(
          and(
            eq(suiteLinksTable.id, linkId),
            eq(suiteLinksTable.aibeatUserId, user.id),
          ),
        )
        .limit(1);
      if (!lockedUser || !currentLink) return "stale" as const;
      if (
        lockedUser.stripeSubscriptionId !== subscription.id &&
        (lockedUser.stripeSubscriptionId !==
          (user.stripeSubscriptionId ?? null) ||
          observedCurrentSubscriptionIsNonterminal)
      ) {
        return "stale" as const;
      }
      if (
        currentLink.stripeSubscriptionId &&
        currentLink.stripeSubscriptionId !== subscription.id &&
        (currentLink.subscriptionStatus === "active" ||
          currentLink.subscriptionStatus === "past_due")
      ) {
        return "stale" as const;
      }

      const [existingSuiteSub] = await tx
        .select({
          id: suiteSubscriptionsTable.id,
          aipodCredits: suiteSubscriptionsTable.aipodCredits,
        })
        .from(suiteSubscriptionsTable)
        .where(eq(suiteSubscriptionsTable.linkId, linkId))
        .limit(1);

      if (existingSuiteSub) {
        await tx
          .update(suiteSubscriptionsTable)
          .set({
            stripeSubscriptionId: subscription.id,
            status: suiteStatus as "none" | "active" | "past_due" | "cancelled",
            cancelAtPeriodEnd,
            currentPeriodEnd,
            priceLookupKey: resolvedLookupKey,
            stripePriceId: item?.price?.id ?? null,
          })
          .where(eq(suiteSubscriptionsTable.id, existingSuiteSub.id));
      } else {
        await tx.insert(suiteSubscriptionsTable).values({
          id: randomUUID(),
          linkId,
          stripeSubscriptionId: subscription.id,
          status: suiteStatus as "none" | "active" | "past_due" | "cancelled",
          cancelAtPeriodEnd,
          currentPeriodEnd,
          priceLookupKey: resolvedLookupKey,
          stripePriceId: item?.price?.id ?? null,
        });
      }

      await tx
        .update(suiteLinksTable)
        .set({
          subscriptionStatus: suiteStatus as "none" | "active" | "past_due" | "cancelled",
          stripeSubscriptionId: subscription.id,
          checkoutPendingUntil: null,
        })
        .where(eq(suiteLinksTable.id, linkId));
      await tx
        .update(usersTable)
        .set({
          stripeSubscriptionId: subscription.id,
          subscriptionStatus: isActive
            ? "active"
            : subscription.status === "canceled"
              ? "cancelled"
              : subscription.status,
          billingCheckoutPendingUntil: null,
        })
        .where(eq(usersTable.id, user.id));

      await tx
        .insert(suiteOutboxEventsTable)
        .values({
          id: randomUUID(),
          linkId,
          eventKey: `stripe.${stripeEventId}.subscription.lifecycle`,
          eventType: "subscription.lifecycle",
          payload: JSON.stringify({
            subscriptionId: subscription.id,
            status: subscription.status,
            cancelAtPeriodEnd,
            currentPeriodEnd: currentPeriodEnd?.toISOString() ?? null,
            priceLookupKey: resolvedLookupKey,
          }),
        })
        .onConflictDoNothing({ target: suiteOutboxEventsTable.eventKey });

      if (subscription.status === "canceled") {
        await tx
          .insert(creditsTable)
          .values({ id: randomUUID(), userId: user.id })
          .onConflictDoNothing({ target: creditsTable.userId });
        await tx
          .update(creditsTable)
          .set({
            subscriptionCredits: 0,
            creditsRemaining: sql`${creditsTable.topupCredits}`,
          })
          .where(eq(creditsTable.userId, user.id));

        const revokeCredits =
          existingSuiteSub?.aipodCredits ??
          parseAipodCredits(item?.price?.metadata);
        await tx
          .insert(suiteOutboxEventsTable)
          .values({
            id: randomUUID(),
            linkId,
            eventKey: `stripe.${stripeEventId}.credits.revoke`,
            eventType: "credits.revoke",
            payload: JSON.stringify({
              subscriptionId: subscription.id,
              reason: "subscription_canceled",
              aipodCredits: revokeCredits,
              priceLookupKey: resolvedLookupKey,
            }),
          })
          .onConflictDoNothing({ target: suiteOutboxEventsTable.eventKey });
      }

      if (subscription.status === "past_due") {
        await tx
          .insert(suiteOutboxEventsTable)
          .values({
            id: randomUUID(),
            linkId,
            eventKey: `subscription.${subscription.id}.payment_failed`,
            eventType: "subscription.payment_failed",
            payload: JSON.stringify({
              subscriptionId: subscription.id,
              status: "past_due",
            }),
          })
          .onConflictDoNothing({ target: suiteOutboxEventsTable.eventKey });
      }

      return "applied" as const;
    });

    if (lifecycleResult === "stale") {
      logger.info(
        { subscriptionId: subscription.id, userId: user.id, linkId },
        "Ignoring stale Suite lifecycle event after another subscription became authoritative",
      );
    }
    return;
  }

  // ── Generic (non-Suite) subscription lifecycle ────────────────────────────
  const [suiteAuthority] = await db
    .select({
      subscriptionStatus: suiteLinksTable.subscriptionStatus,
      stripeSubscriptionId: suiteLinksTable.stripeSubscriptionId,
    })
    .from(suiteLinksTable)
    .where(eq(suiteLinksTable.aibeatUserId, user.id))
    .limit(1);
  if (
    suiteAuthority?.stripeSubscriptionId &&
    suiteAuthority.stripeSubscriptionId !== subscription.id &&
    (suiteAuthority.subscriptionStatus === "active" ||
      suiteAuthority.subscriptionStatus === "past_due")
  ) {
    logger.info(
      {
        staleSubscriptionId: subscription.id,
        authoritativeSubscriptionId: suiteAuthority.stripeSubscriptionId,
        userId: user.id,
      },
      "Ignoring standalone lifecycle event while Suite owns the entitlement",
    );
    return;
  }
  if (
    user.stripeSubscriptionId &&
    user.stripeSubscriptionId !== subscription.id &&
    !isActive
  ) {
    logger.info(
      {
        staleSubscriptionId: subscription.id,
        authoritativeSubscriptionId: user.stripeSubscriptionId,
        userId: user.id,
      },
      "Ignoring stale standalone subscription lifecycle event",
    );
    return;
  }
  if (isActive && user.stripeSubscriptionId !== subscription.id) {
    if (user.stripeSubscriptionId) {
      const currentUserSubscription = await stripe.subscriptions.retrieve(
        user.stripeSubscriptionId,
      );
      if (
        currentUserSubscription.status !== "canceled" &&
        currentUserSubscription.status !== "incomplete_expired"
      ) {
        logger.info(
          {
            staleSubscriptionId: subscription.id,
            authoritativeSubscriptionId: user.stripeSubscriptionId,
            userId: user.id,
          },
          "Ignoring standalone lifecycle event while another subscription is live",
        );
        return;
      }
    }
    if (subscription.status !== "active" && subscription.status !== "trialing") {
      logger.info(
        {
          staleSubscriptionId: subscription.id,
          liveStatus: subscription.status,
          userId: user.id,
        },
        "Ignoring stale active standalone lifecycle snapshot",
      );
      return;
    }
  }

  const [claimedUser] = await db
    .update(usersTable)
    .set({
      stripeSubscriptionId: subscription.id,
      subscriptionStatus: isActive
        ? "active"
        : subscription.status === "canceled"
          ? "cancelled"
          : subscription.status,
      billingCheckoutPendingUntil: null,
    })
    .where(
      and(
        eq(usersTable.id, user.id),
        user.stripeSubscriptionId
          ? eq(usersTable.stripeSubscriptionId, user.stripeSubscriptionId)
          : isNull(usersTable.stripeSubscriptionId),
      ),
    )
    .returning({ id: usersTable.id });
  if (!claimedUser) {
    logger.info(
      { subscriptionId: subscription.id, userId: user.id },
      "Ignoring lifecycle event after subscription authority changed",
    );
    return;
  }

  // A standalone subscription checkout and Suite checkout use the same
  // checkoutPendingUntil field as a distributed mutex. Once Stripe confirms
  // the standalone subscription, release that reservation; the stored active
  // subscription now becomes the durable exclusion check.
  await db
    .update(suiteLinksTable)
    .set({ checkoutPendingUntil: null })
    .where(eq(suiteLinksTable.aibeatUserId, user.id));
  // On cancellation, zero out plan/trial credits. Purchased top-up credits are
  // preserved (they never expire), so creditsRemaining collapses to the top-up
  // balance.
  if (subscription.status === "canceled") {
    await ensureCreditsRow(user.id);
    await db
      .update(creditsTable)
      .set({
        subscriptionCredits: 0,
        creditsRemaining: sql`${creditsTable.topupCredits}`,
      })
      .where(eq(creditsTable.userId, user.id));
    logger.info({ userId: user.id }, "Subscription cancelled — plan credits zeroed (top-up kept)");
  }
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
    "invoice.payment_failed",
    "charge.refunded",
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
        case "invoice.payment_failed":
          await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
          replayed++;
          break;
        case "charge.refunded":
          await handleChargeRefunded(event, event.data.object as Stripe.Charge);
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
            event.id,
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

// ─── Suite: invoice.payment_failed ────────────────────────────────────────────

async function handleInvoicePaymentFailed(
  invoice: Stripe.Invoice,
  stripeOverride?: Stripe,
): Promise<void> {
  // Only care about Suite subscriptions here; generic failures are handled by
  // handleSubscriptionUpdated (which fires on status → past_due).
  const subscriptionId = resolveSubscriptionId(invoice);
  if (!subscriptionId) return;

  try {
    const stripe = stripeOverride ?? (await getUncachableStripeClient());
    const sub = await stripe.subscriptions.retrieve(subscriptionId);
    const linkId: string | null = sub.metadata?.["linkId"] ?? null;
    const resolvedLookupKey = sub.items.data[0]?.price?.lookup_key ?? null;
    if (!isSuiteLookupKey(resolvedLookupKey) || !linkId) return;

    await db.transaction(async (tx) => {
      await tx
        .update(suiteSubscriptionsTable)
        .set({ status: "past_due" })
        .where(eq(suiteSubscriptionsTable.linkId, linkId));
      await tx
        .update(suiteLinksTable)
        .set({ subscriptionStatus: "past_due" })
        .where(eq(suiteLinksTable.id, linkId));
      await tx
        .insert(suiteOutboxEventsTable)
        .values({
          id: randomUUID(),
          linkId,
          eventKey: `invoice.${invoice.id ?? subscriptionId}.payment_failed`,
          eventType: "subscription.payment_failed",
          payload: JSON.stringify({
            invoiceId: invoice.id ?? null,
            subscriptionId,
            status: "payment_failed",
          }),
        })
        .onConflictDoNothing({ target: suiteOutboxEventsTable.eventKey });
    });

    logger.info({ linkId, invoiceId: invoice.id }, "Suite invoice.payment_failed enqueued");
  } catch (err) {
    logger.error({ err, invoiceId: invoice.id }, "Suite: failed to handle invoice.payment_failed");
  }
}

// ─── Suite: charge.refunded (full refund = revoke) ────────────────────────────

async function handleChargeRefunded(
  event: Stripe.Event,
  charge: Stripe.Charge,
  stripeOverride?: Stripe,
): Promise<void> {
  // Only act on a full refund (amount_refunded == amount)
  if (charge.amount_refunded !== charge.amount) return;

  type ChargeWithInvoice = Stripe.Charge & { invoice?: string | { id: string } | null };
  const chargeInvoice = (charge as ChargeWithInvoice).invoice;
  if (!chargeInvoice) return;

  const invoiceId =
    typeof chargeInvoice === "string" ? chargeInvoice : chargeInvoice?.id;
  if (!invoiceId) return;

  try {
    const stripe = stripeOverride ?? (await getUncachableStripeClient());
    const invoice = await stripe.invoices.retrieve(invoiceId);
    const subscriptionId = resolveSubscriptionId(invoice);
    if (!subscriptionId) return;

    const sub = await stripe.subscriptions.retrieve(subscriptionId);
    const linkId: string | null = sub.metadata?.["linkId"] ?? null;
    const resolvedLookupKey = sub.items.data[0]?.price?.lookup_key ?? null;
    if (!isSuiteLookupKey(resolvedLookupKey) || !linkId) return;

    const [grantEvent] = await db
      .select({ payload: suiteOutboxEventsTable.payload })
      .from(suiteOutboxEventsTable)
      .where(
        eq(
          suiteOutboxEventsTable.eventKey,
          `invoice.${invoiceId}.credits.grant`,
        ),
      )
      .limit(1);
    let grantPayload: Record<string, unknown> = {};
    if (grantEvent?.payload) {
      try {
        grantPayload = JSON.parse(grantEvent.payload) as Record<string, unknown>;
      } catch {
        logger.warn(
          { linkId, invoiceId },
          "Suite refund: stored grant payload was not valid JSON",
        );
      }
    }
    const payloadAipodCredits = Number(grantPayload["aipodCredits"]);
    const aipodCredits =
      Number.isFinite(payloadAipodCredits) && payloadAipodCredits > 0
        ? payloadAipodCredits
        : parseAipodCredits(sub.items.data[0]?.price?.metadata);
    const grantedLookupKey =
      typeof grantPayload["priceLookupKey"] === "string"
        ? grantPayload["priceLookupKey"]
        : resolvedLookupKey;

    const customerId =
      typeof charge.customer === "string" ? charge.customer : charge.customer?.id;
    const user = customerId ? await findUserByCustomerId(customerId) : null;
    let currentGrantCredits = 0;
    if (user) {
      const [refundedGrant] = await db
        .select({
          id: creditGrantsTable.id,
          creditsGranted: creditGrantsTable.creditsGranted,
        })
        .from(creditGrantsTable)
        .where(
          and(
            eq(creditGrantsTable.userId, user.id),
            eq(creditGrantsTable.stripeInvoiceId, invoiceId),
          ),
        )
        .limit(1);
      const [latestSubscriptionGrant] = await db
        .select({ id: creditGrantsTable.id })
        .from(creditGrantsTable)
        .where(
          and(
            eq(creditGrantsTable.userId, user.id),
            eq(creditGrantsTable.source, "subscription"),
          ),
        )
        .orderBy(desc(creditGrantsTable.createdAt))
        .limit(1);
      if (refundedGrant?.id === latestSubscriptionGrant?.id) {
        currentGrantCredits = refundedGrant.creditsGranted;
      }
    }

    await db.transaction(async (tx) => {
      await tx
        .insert(suiteOutboxEventsTable)
        .values({
          id: randomUUID(),
          linkId,
          eventKey: `charge.${charge.id}.full_refund.revoke`,
          eventType: "credits.revoke",
          payload: JSON.stringify({
            chargeId: charge.id,
            invoiceId,
            subscriptionId,
            reason: "full_refund",
            aipodCredits,
            priceLookupKey: grantedLookupKey,
          }),
        })
        .onConflictDoNothing({ target: suiteOutboxEventsTable.eventKey });

      // A refund does not cancel Stripe's subscription. Revoke only unspent
      // credits from the currently active invoice; older grants have already
      // expired through the next period's reset.
      if (user && currentGrantCredits > 0) {
        await tx
          .update(creditsTable)
          .set({
            subscriptionCredits: sql`greatest(${creditsTable.subscriptionCredits} - ${currentGrantCredits}, 0)`,
            creditsRemaining: sql`${creditsTable.topupCredits} + greatest(${creditsTable.subscriptionCredits} - ${currentGrantCredits}, 0)`,
          })
          .where(eq(creditsTable.userId, user.id));
      }
    });

    logger.info(
      {
        linkId,
        chargeId: charge.id,
        eventId: event.id,
        currentGrantCredits,
      },
      "Suite full refund: credits revoked, revoke event enqueued",
    );
  } catch (err) {
    logger.error({ err, chargeId: charge.id }, "Suite: failed to handle charge.refunded");
  }
}

export class WebhookHandlers {
  static async processSuiteWebhook(
    payload: Buffer,
    signature: string,
  ): Promise<void> {
    if (!Buffer.isBuffer(payload)) {
      throw new Error("Suite Stripe webhook payload must be a Buffer");
    }
    const webhookSecret = getSuiteWebhookSecret();
    if (!webhookSecret) {
      throw new Error("Dedicated Suite Stripe webhook secret is not configured");
    }

    const stripe = await getSuiteStripeClient();
    const event = stripe.webhooks.constructEvent(
      payload,
      signature,
      webhookSecret,
    );

    switch (event.type) {
      case "invoice.paid":
        await handleInvoicePaid(
          event,
          event.data.object as Stripe.Invoice,
          stripe,
        );
        break;
      case "invoice.payment_failed":
        await handleInvoicePaymentFailed(
          event.data.object as Stripe.Invoice,
          stripe,
        );
        break;
      case "charge.refunded":
        await handleChargeRefunded(
          event,
          event.data.object as Stripe.Charge,
          stripe,
        );
        break;
      case "checkout.session.completed":
        await handleCheckoutCompleted(
          event,
          event.data.object as Stripe.Checkout.Session,
          stripe,
        );
        break;
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await handleSubscriptionUpdated(
          event.id,
          event.data.object as Stripe.Subscription,
          stripe,
        );
        break;
      default:
        break;
    }
  }

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
        case "invoice.payment_failed":
          await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
          break;
        case "charge.refunded":
          await handleChargeRefunded(event, event.data.object as Stripe.Charge);
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
            event.id,
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
