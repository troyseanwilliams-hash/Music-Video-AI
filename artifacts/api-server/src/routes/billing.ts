import { Router, type Request } from "express";
import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
} from "drizzle-orm";
import { db } from "@workspace/db";
import {
  usersTable,
  creditsTable,
  creditGrantsTable,
  suiteLinksTable,
} from "@workspace/db";
import { randomUUID } from "crypto";
import { getUncachableStripeClient } from "../lib/stripeClient.js";
import type Stripe from "stripe";

const router = Router();

function buildAppUrl(req: Request, path: string): string {
  const replitDomain = process.env["REPLIT_DOMAINS"]?.split(",")[0];
  if (replitDomain) {
    return `https://${replitDomain}${path}`;
  }
  const host = req.get("host") ?? "localhost";
  return `${req.protocol}://${host}${path}`;
}

function safeCheckoutUrl(
  req: Request,
  raw: string | null | undefined,
  fallbackPath: string,
): string {
  if (raw?.startsWith("/") && !raw.startsWith("//")) {
    return buildAppUrl(req, raw);
  }
  return buildAppUrl(req, fallbackPath);
}

function parseCredits(meta: Stripe.Metadata | null | undefined): number {
  if (!meta) return 0;
  const raw = meta["credits"];
  if (!raw) return 0;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// Returns a Stripe customer ID that is guaranteed to exist on the *current*
// Stripe account. If the user has no stored customer, or the stored ID belongs
// to a different account (e.g. after switching live keys, Stripe returns a
// `resource_missing` error) or was deleted, a fresh customer is created and
// persisted. This keeps checkout and the billing portal working across account
// migrations instead of failing with "No such customer".
async function getOrRepairStripeCustomerId(
  stripe: Stripe,
  user: typeof usersTable.$inferSelect,
): Promise<string> {
  const existingId = user.stripeCustomerId;
  if (existingId) {
    try {
      const customer = await stripe.customers.retrieve(existingId);
      if (!("deleted" in customer) || !customer.deleted) {
        return existingId;
      }
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      if (code !== "resource_missing") {
        throw err;
      }
      // Stale ID from a different Stripe account — recreate below.
    }
  }

  const customer = await stripe.customers.create({
    email: user.email ?? undefined,
    name: [user.firstName, user.lastName].filter(Boolean).join(" ") || undefined,
    metadata: { userId: user.id },
  });
  await db
    .update(usersTable)
    .set({ stripeCustomerId: customer.id })
    .where(eq(usersTable.id, user.id));

  // Ensure a credits row exists for the grant flow.
  await db
    .insert(creditsTable)
    .values({ id: randomUUID(), userId: user.id })
    .onConflictDoNothing({ target: creditsTable.userId });

  return customer.id;
}

// Known topup lookup keys in ascending price order.
// Fetch these directly so we don't depend on Stripe product active-status or metadata.
const TOPUP_LOOKUP_KEYS = ["topup_1000", "topup_5000", "topup_20000"] as const;

const DIRECT_CHECKOUT_LOOKUP_KEYS = new Set([
  "starter_monthly",
  "starter_yearly",
  "pro_monthly",
  "pro_yearly",
  "studio_monthly",
  "studio_yearly",
  "topup_250",
  ...TOPUP_LOOKUP_KEYS,
]);

export function isDirectCheckoutLookupKey(
  lookupKey: string | null | undefined,
): boolean {
  return Boolean(lookupKey && DIRECT_CHECKOUT_LOOKUP_KEYS.has(lookupKey));
}

const TOPUP_META: Record<
  string,
  { name: string; description: string; popular: boolean }
> = {
  topup_1000: {
    name: "1,000 Credits",
    description: "1,000 credits · one-time purchase · never expires",
    popular: false,
  },
  topup_5000: {
    name: "5,000 Credits",
    description: "5,000 credits · one-time purchase · never expires · save 15%",
    popular: true,
  },
  topup_20000: {
    name: "20,000 Credits",
    description:
      "20,000 credits · one-time purchase · never expires · save 25%",
    popular: false,
  },
};

// ── Static plan catalog — no Stripe call needed ───────────────────────────────
// Prices use lookupKey as the price `id` so the frontend can pass it straight
// to /billing/checkout, which resolves the real Stripe price ID at purchase time.
const STATIC_PLANS = {
  subscriptions: [
    {
      id: "starter",
      name: "Starter",
      description: "1,000 credits per month — best for casual creators",
      kind: "subscription" as const,
      popular: false,
      prices: [
        { id: "starter_monthly", lookupKey: "starter_monthly", nickname: "Starter Monthly", unitAmount: 2000, currency: "usd", credits: 1000, interval: "month" },
        { id: "starter_yearly", lookupKey: "starter_yearly", nickname: "Starter Yearly", unitAmount: 20000, currency: "usd", credits: 12000, interval: "year" },
      ],
    },
    {
      id: "pro",
      name: "Pro",
      description: "2,500 credits per month — for serious creators",
      kind: "subscription" as const,
      popular: true,
      prices: [
        { id: "pro_monthly", lookupKey: "pro_monthly", nickname: "Pro Monthly", unitAmount: 4500, currency: "usd", credits: 2500, interval: "month" },
        { id: "pro_yearly", lookupKey: "pro_yearly", nickname: "Pro Yearly", unitAmount: 45000, currency: "usd", credits: 30000, interval: "year" },
      ],
    },
    {
      id: "studio",
      name: "Studio",
      description: "5000 credits per month — for production teams",
      kind: "subscription" as const,
      popular: false,
      prices: [
        { id: "studio_monthly", lookupKey: "studio_monthly", nickname: "Studio Monthly", unitAmount: 7900, currency: "usd", credits: 5000, interval: "month" },
        { id: "studio_yearly", lookupKey: "studio_yearly", nickname: "Studio Yearly", unitAmount: 79000, currency: "usd", credits: 60000, interval: "year" },
      ],
    },
  ],
  topups: [
    {
      // Low-cost entry point: same $0.02/credit rate as the other packs (no
      // discount — it's an impulse-buy price, not a bulk deal), sized to let a
      // first-time, still-skeptical visitor try the AI Generator for a few
      // dollars instead of the previous $20 minimum. Requires a matching
      // Stripe Price with lookup_key "topup_250" and metadata.credits="250"
      // (see webhookHandlers.ts parseCreditsFromMetadata) — created manually
      // in the Stripe Dashboard, not by this codebase.
      id: "topup_250",
      name: "250 Credits",
      description: "250 credits · one-time purchase · never expires · perfect for trying it out",
      kind: "topup" as const,
      popular: false,
      prices: [
        { id: "topup_250", lookupKey: "topup_250", nickname: "250 Credits", unitAmount: 500, currency: "usd", credits: 250, interval: null },
      ],
    },
    {
      id: "topup_1000",
      name: "1,000 Credits",
      description: "1,000 credits · one-time purchase · never expires",
      kind: "topup" as const,
      popular: false,
      prices: [
        { id: "topup_1000", lookupKey: "topup_1000", nickname: "1000 Credits", unitAmount: 2000, currency: "usd", credits: 1000, interval: null },
      ],
    },
    {
      id: "topup_5000",
      name: "5,000 Credits",
      description: "5,000 credits · one-time purchase · never expires · save 15%",
      kind: "topup" as const,
      popular: true,
      prices: [
        { id: "topup_5000", lookupKey: "topup_5000", nickname: "5000 Credits", unitAmount: 8500, currency: "usd", credits: 5000, interval: null },
      ],
    },
    {
      id: "topup_20000",
      name: "20,000 Credits",
      description: "20,000 credits · one-time purchase · never expires · save 25%",
      kind: "topup" as const,
      popular: false,
      prices: [
        { id: "topup_20000", lookupKey: "topup_20000", nickname: "20000 Credits", unitAmount: 30000, currency: "usd", credits: 20000, interval: null },
      ],
    },
  ],
};

router.get("/billing/plans", (_req, res) => {
  res.json(STATIC_PLANS);
});

router.get("/billing/subscription", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, req.user.id))
    .limit(1);

  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const [credits] = await db
    .select()
    .from(creditsTable)
    .where(eq(creditsTable.userId, req.user.id))
    .limit(1);

  let planName: string | null = null;
  let priceLookupKey: string | null = null;
  let renewsAt: string | null = null;
  let cancelAtPeriodEnd: boolean | null = null;

  if (user.stripeSubscriptionId) {
    try {
      const stripe = await getUncachableStripeClient();
      const sub = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);
      const item = sub.items.data[0];
      if (item) {
        priceLookupKey = item.price.lookup_key ?? null;
        if (typeof item.price.product === "string") {
          const product = await stripe.products.retrieve(item.price.product);
          planName = product.name;
        }
      }
      // In the 2025-03-31.basil+ API versions, current_period_end was removed
      // from the Subscription object and now lives on each subscription item.
      // Read it from the item, falling back to the legacy top-level field so
      // this keeps working regardless of the active API version.
      const itemPeriodEnd = item
        ? (item as Stripe.SubscriptionItem & { current_period_end?: number })
            .current_period_end
        : undefined;
      const legacyPeriodEnd = (
        sub as Stripe.Subscription & { current_period_end?: number }
      ).current_period_end;
      const periodEnd =
        typeof itemPeriodEnd === "number" ? itemPeriodEnd : legacyPeriodEnd;
      if (typeof periodEnd === "number") {
        renewsAt = new Date(periodEnd * 1000).toISOString();
      }
      cancelAtPeriodEnd = sub.cancel_at_period_end;
    } catch (err) {
      req.log.warn({ err }, "Failed to load subscription details from Stripe");
    }
  }

  res.json({
    subscriptionStatus: user.subscriptionStatus,
    hasStripeCustomer: Boolean(user.stripeCustomerId),
    creditsRemaining: credits?.creditsRemaining ?? 0,
    subscriptionCredits: credits?.subscriptionCredits ?? 0,
    topupCredits: credits?.topupCredits ?? 0,
    planName,
    priceLookupKey,
    renewsAt,
    cancelAtPeriodEnd,
  });
});

router.post("/billing/checkout", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  // Accept either a Stripe price ID (price_xxx) or a lookup key (e.g. pro_monthly)
  const { priceId, lookupKey: rawLookupKey, successUrl, cancelUrl } = req.body as {
    priceId?: string;
    lookupKey?: string;
    successUrl?: string | null;
    cancelUrl?: string | null;
  };

  const priceIdentifier = priceId ?? rawLookupKey;
  if (!priceIdentifier || typeof priceIdentifier !== "string") {
    res.status(400).json({ error: "priceId or lookupKey is required" });
    return;
  }
  if (
    !priceIdentifier.startsWith("price_") &&
    !isDirectCheckoutLookupKey(priceIdentifier)
  ) {
    res.status(400).json({
      error: "That price is not available through standalone checkout.",
      code: "PRICE_NOT_ALLOWED",
    });
    return;
  }

  let reservedUserUntil: Date | null = null;
  let reservedSuiteLinkId: string | null = null;

  try {
    const stripe = await getUncachableStripeClient();

    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, req.user.id))
      .limit(1);

    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    // Resolve lookup key → real Stripe price ID if needed
    let resolvedPriceId = priceIdentifier;
    if (!priceIdentifier.startsWith("price_")) {
      const found = await stripe.prices.list({
        lookup_keys: [priceIdentifier],
        active: true,
        limit: 1,
      });
      const resolved = found.data[0];
      if (!resolved) {
        res.status(400).json({ error: `No active price found for lookup key: ${priceIdentifier}` });
        return;
      }
      resolvedPriceId = resolved.id;
    }

    const price = await stripe.prices.retrieve(resolvedPriceId);
    const priceId = resolvedPriceId;
    if (!isDirectCheckoutLookupKey(price.lookup_key)) {
      res.status(400).json({
        error: "That price is not available through standalone checkout.",
        code: "PRICE_NOT_ALLOWED",
      });
      return;
    }
    const mode: "subscription" | "payment" = price.recurring
      ? "subscription"
      : "payment";

    let checkoutPendingUntil: Date | null = null;
    let suiteLinkId: string | null = null;
    if (mode === "subscription") {
      if (user.stripeSubscriptionId) {
        try {
          const existing = await stripe.subscriptions.retrieve(
            user.stripeSubscriptionId,
          );
          if (
            existing.status !== "canceled" &&
            existing.status !== "incomplete_expired"
          ) {
            res.status(409).json({
              error:
                "An active subscription already exists. Manage or cancel it before starting another checkout.",
              code: "ACTIVE_SUBSCRIPTION",
            });
            return;
          }
        } catch (err) {
          const code =
            typeof err === "object" && err !== null && "code" in err
              ? String((err as { code?: unknown }).code ?? "")
              : "";
          const [formerSuite] =
            code === "resource_missing"
              ? await db
                  .select({ id: suiteLinksTable.id })
                  .from(suiteLinksTable)
                  .where(
                    and(
                      eq(suiteLinksTable.aibeatUserId, user.id),
                      eq(
                        suiteLinksTable.stripeSubscriptionId,
                        user.stripeSubscriptionId,
                      ),
                      inArray(suiteLinksTable.subscriptionStatus, [
                        "none",
                        "cancelled",
                      ]),
                    ),
                  )
                  .limit(1)
              : [null];
          if (formerSuite) {
            await db
              .update(usersTable)
              .set({
                stripeSubscriptionId: null,
                subscriptionStatus: "none",
              })
              .where(
                and(
                  eq(usersTable.id, user.id),
                  eq(
                    usersTable.stripeSubscriptionId,
                    user.stripeSubscriptionId,
                  ),
                ),
              );
          } else {
          req.log.warn(
            { err },
            "Could not verify existing subscription for standalone checkout",
          );
          res.status(503).json({
            error:
              "Billing status could not be verified. Please try again before starting checkout.",
            code: "BILLING_STATUS_UNAVAILABLE",
          });
          return;
          }
        }
      }

      checkoutPendingUntil = new Date(Date.now() + 31 * 60 * 1000);
      const [reservedUser] = await db
        .update(usersTable)
        .set({ billingCheckoutPendingUntil: checkoutPendingUntil })
        .where(
          and(
            eq(usersTable.id, user.id),
            or(
              isNull(usersTable.billingCheckoutPendingUntil),
              lt(usersTable.billingCheckoutPendingUntil, new Date()),
            ),
          ),
        )
        .returning({ id: usersTable.id });
      if (!reservedUser) {
        res.status(409).json({
          error:
            "Another subscription checkout is already in progress. Please finish or cancel it first.",
          code: "CHECKOUT_IN_PROGRESS",
        });
        return;
      }
      reservedUserUntil = checkoutPendingUntil;

      const [finalizedLink] = await db
        .select({
          id: suiteLinksTable.id,
          subscriptionStatus: suiteLinksTable.subscriptionStatus,
        })
        .from(suiteLinksTable)
        .where(
          and(
            eq(suiteLinksTable.aibeatUserId, user.id),
            isNotNull(suiteLinksTable.aipodUserId),
          ),
        )
        .limit(1);

      if (
        finalizedLink?.subscriptionStatus === "active" ||
        finalizedLink?.subscriptionStatus === "past_due"
      ) {
        await db
          .update(usersTable)
          .set({ billingCheckoutPendingUntil: null })
          .where(
            and(
              eq(usersTable.id, user.id),
              eq(usersTable.billingCheckoutPendingUntil, checkoutPendingUntil),
            ),
          );
        reservedUserUntil = null;
        res.status(409).json({
          error:
            "A Suite subscription is already active. Manage it before starting a standalone plan.",
          code: "ACTIVE_SUITE_SUBSCRIPTION",
        });
        return;
      }

      if (finalizedLink) {
        const [reserved] = await db
          .update(suiteLinksTable)
          .set({ checkoutPendingUntil })
          .where(
            and(
              eq(suiteLinksTable.id, finalizedLink.id),
              inArray(suiteLinksTable.subscriptionStatus, ["none", "cancelled"]),
              or(
                isNull(suiteLinksTable.checkoutPendingUntil),
                lt(suiteLinksTable.checkoutPendingUntil, new Date()),
              ),
            ),
          )
          .returning({ id: suiteLinksTable.id });
        if (!reserved) {
          await db
            .update(usersTable)
            .set({ billingCheckoutPendingUntil: null })
            .where(
              and(
                eq(usersTable.id, user.id),
                eq(usersTable.billingCheckoutPendingUntil, checkoutPendingUntil),
              ),
            );
          reservedUserUntil = null;
          res.status(409).json({
            error:
              "Another checkout is already in progress. Please finish or cancel it first.",
            code: "CHECKOUT_IN_PROGRESS",
          });
          return;
        }
        suiteLinkId = reserved.id;
        reservedSuiteLinkId = reserved.id;
      }
    }

    const customerId = await getOrRepairStripeCustomerId(stripe, user);
    const defaultSuccess = safeCheckoutUrl(
      req,
      successUrl,
      "/pricing?status=success",
    );
    const defaultCancel = safeCheckoutUrl(
      req,
      cancelUrl,
      "/pricing?status=cancelled",
    );

    const session = await stripe.checkout.sessions.create(
      {
        mode,
        customer: customerId,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: defaultSuccess,
        cancel_url: defaultCancel,
        allow_promotion_codes: true,
        ...(checkoutPendingUntil
          ? { expires_at: Math.floor(checkoutPendingUntil.getTime() / 1000) }
          : {}),
        ...(mode === "subscription"
          ? {
              subscription_data: {
                metadata: { userId: user.id },
              },
            }
          : {
              payment_intent_data: {
                metadata: { userId: user.id, priceId },
              },
            }),
      },
      checkoutPendingUntil
        ? {
            idempotencyKey: `direct-checkout:${user.id}:${checkoutPendingUntil.getTime()}`,
          }
        : undefined,
    );

    if (!session.url) {
      throw new Error("Stripe did not return a checkout URL");
    }

    res.json({ url: session.url });
  } catch (err) {
    if (reservedSuiteLinkId && reservedUserUntil) {
      await db
        .update(suiteLinksTable)
        .set({ checkoutPendingUntil: null })
        .where(
          and(
            eq(suiteLinksTable.id, reservedSuiteLinkId),
            eq(suiteLinksTable.checkoutPendingUntil, reservedUserUntil),
          ),
        )
        .catch(() => undefined);
    }
    if (reservedUserUntil) {
      await db
        .update(usersTable)
        .set({ billingCheckoutPendingUntil: null })
        .where(
          and(
            eq(usersTable.id, req.user.id),
            eq(usersTable.billingCheckoutPendingUntil, reservedUserUntil),
          ),
        )
        .catch(() => undefined);
    }
    req.log.error({ err }, "Failed to create checkout session");
    res.status(500).json({ error: "Failed to create checkout session" });
  }
});

router.get("/billing/grants", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const grants = await db
      .select({
        id: creditGrantsTable.id,
        source: creditGrantsTable.source,
        creditsGranted: creditGrantsTable.creditsGranted,
        stripeInvoiceId: creditGrantsTable.stripeInvoiceId,
        stripeCheckoutSessionId: creditGrantsTable.stripeCheckoutSessionId,
        stripePriceId: creditGrantsTable.stripePriceId,
        createdAt: creditGrantsTable.createdAt,
      })
      .from(creditGrantsTable)
      .where(eq(creditGrantsTable.userId, req.user.id))
      .orderBy(desc(creditGrantsTable.createdAt))
      .limit(50);

    const stripe = await getUncachableStripeClient();

    const grantsWithReceipts = await Promise.all(
      grants.map(async (g) => {
        let receiptUrl: string | null = null;

        try {
          if (g.stripeInvoiceId) {
            const invoice = await stripe.invoices.retrieve(g.stripeInvoiceId);
            receiptUrl = invoice.hosted_invoice_url ?? null;
          } else if (g.stripeCheckoutSessionId) {
            const session = await stripe.checkout.sessions.retrieve(
              g.stripeCheckoutSessionId,
              { expand: ["payment_intent.latest_charge"] },
            );
            const pi = session.payment_intent as
              | (Stripe.PaymentIntent & {
                  latest_charge?: Stripe.Charge | null;
                })
              | null;
            receiptUrl = pi?.latest_charge?.receipt_url ?? null;
          }
        } catch {
          // Non-fatal: receipt URL enrichment failure should not block the response
        }

        return {
          id: g.id,
          source: g.source,
          creditsGranted: g.creditsGranted,
          stripeInvoiceId: g.stripeInvoiceId,
          stripeCheckoutSessionId: g.stripeCheckoutSessionId,
          stripePriceId: g.stripePriceId,
          receiptUrl,
          createdAt: g.createdAt.toISOString(),
        };
      }),
    );

    res.json({ grants: grantsWithReceipts });
  } catch (err) {
    req.log.error({ err }, "Failed to list billing grants");
    res.status(500).json({ error: "Failed to load credit history" });
  }
});

router.post("/billing/portal", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { returnUrl } = (req.body ?? {}) as { returnUrl?: string | null };

  try {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, req.user.id))
      .limit(1);

    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const stripe = await getUncachableStripeClient();
    const customerId = await getOrRepairStripeCustomerId(stripe, user);
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl || buildAppUrl(req, "/dashboard"),
    });
    res.json({ url: session.url });
  } catch (err) {
    req.log.error({ err }, "Failed to create billing portal session");
    res.status(500).json({ error: "Failed to create portal session" });
  }
});

// POST /billing/redeem-drift-pro — comp AIBeatSync membership for Digital
// Drift *Pro* subscribers. Both sites share one Stripe account, so we verify
// against Stripe directly (no shared secret codes): if the logged-in user's
// email has an active Digital Drift Pro subscription (price lookup_key starting
// "creator_pro"), grant them an active AIBeatSync membership. Tied to their
// own email, so it can't be claimed with someone else's subscription.
const DRIFT_PRO_LOOKUP_PREFIX = "creator_pro";

router.post("/billing/redeem-drift-pro", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, req.user.id))
      .limit(1);
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const email = user.email;
    if (!email) {
      res.status(400).json({ error: "Your account has no email on file." });
      return;
    }

    const stripe = await getUncachableStripeClient();
    const customers = await stripe.customers.list({ email, limit: 20 });

    let hasDriftPro = false;
    for (const customer of customers.data) {
      for (const status of ["active", "trialing"] as const) {
        const subs = await stripe.subscriptions.list({ customer: customer.id, status, limit: 50 });
        for (const sub of subs.data) {
          for (const item of sub.items.data) {
            const lk = item.price.lookup_key ?? "";
            if (lk.startsWith(DRIFT_PRO_LOOKUP_PREFIX)) hasDriftPro = true;
          }
        }
        if (hasDriftPro) break;
      }
      if (hasDriftPro) break;
    }

    if (!hasDriftPro) {
      res.status(404).json({
        error: `No active Digital Drift Pro subscription found for ${email}. Make sure you subscribed to Pro using this same email.`,
        code: "NO_DRIFT_PRO",
      });
      return;
    }

    // Grant a comped active membership. Digital Drift subscription webhooks key
    // on their own customer IDs, so this won't be reset by them. A 1-year
    // trialEndsAt backstop keeps access even if status is later recomputed.
    await db
      .update(usersTable)
      .set({
        subscriptionStatus: "active",
        trialEndsAt: new Date(Date.now() + 370 * 24 * 60 * 60 * 1000),
      })
      .where(eq(usersTable.id, user.id));

    req.log.info({ userId: user.id, email }, "Digital Drift Pro bundle redeemed");
    res.json({ success: true, message: "AIBeatSync membership activated through your Digital Drift Pro plan." });
  } catch (err) {
    req.log.error({ err }, "Failed to redeem Digital Drift Pro bundle");
    res.status(500).json({ error: "Could not verify your Digital Drift Pro membership. Please try again." });
  }
});

export default router;
