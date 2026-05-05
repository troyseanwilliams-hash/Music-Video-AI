import { Router, type Request } from "express";
import { eq, desc } from "drizzle-orm";
import { db } from "@workspace/db";
import { usersTable, creditsTable, creditGrantsTable } from "@workspace/db";
import { randomUUID } from "crypto";
import { getUncachableStripeClient } from "../lib/stripeClient";
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

function parseCredits(meta: Stripe.Metadata | null | undefined): number {
  if (!meta) return 0;
  const raw = meta["credits"];
  if (!raw) return 0;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// Known topup lookup keys in ascending price order.
// Fetch these directly so we don't depend on Stripe product active-status or metadata.
const TOPUP_LOOKUP_KEYS = ["topup_1000", "topup_5000", "topup_20000"] as const;

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
      description: "400 credits per month — best for casual creators",
      kind: "subscription" as const,
      popular: false,
      prices: [
        { id: "starter_monthly", lookupKey: "starter_monthly", nickname: "Starter Monthly", unitAmount: 900, currency: "usd", credits: 400, interval: "month" },
        { id: "starter_yearly", lookupKey: "starter_yearly", nickname: "Starter Yearly", unitAmount: 9000, currency: "usd", credits: 4800, interval: "year" },
      ],
    },
    {
      id: "pro",
      name: "Pro",
      description: "1650 credits per month — for serious creators",
      kind: "subscription" as const,
      popular: true,
      prices: [
        { id: "pro_monthly", lookupKey: "pro_monthly", nickname: "Pro Monthly", unitAmount: 2900, currency: "usd", credits: 1650, interval: "month" },
        { id: "pro_yearly", lookupKey: "pro_yearly", nickname: "Pro Yearly", unitAmount: 29000, currency: "usd", credits: 19800, interval: "year" },
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
      const subWithPeriod = sub as Stripe.Subscription & {
        current_period_end?: number;
      };
      if (typeof subWithPeriod.current_period_end === "number") {
        renewsAt = new Date(subWithPeriod.current_period_end * 1000).toISOString();
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

    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        name: [user.firstName, user.lastName].filter(Boolean).join(" ") || undefined,
        metadata: { userId: user.id },
      });
      customerId = customer.id;
      await db
        .update(usersTable)
        .set({ stripeCustomerId: customerId })
        .where(eq(usersTable.id, user.id));

      // Ensure credits row exists for grant flow
      await db
        .insert(creditsTable)
        .values({ id: randomUUID(), userId: user.id })
        .onConflictDoNothing({ target: creditsTable.userId });
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
    const mode: Stripe.Checkout.SessionCreateParams.Mode = price.recurring
      ? "subscription"
      : "payment";

    const defaultSuccess = buildAppUrl(req, "/pricing?status=success");
    const defaultCancel = buildAppUrl(req, "/pricing?status=cancelled");

    const session = await stripe.checkout.sessions.create({
      mode,
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl || defaultSuccess,
      cancel_url: cancelUrl || defaultCancel,
      allow_promotion_codes: true,
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
    });

    if (!session.url) {
      throw new Error("Stripe did not return a checkout URL");
    }

    res.json({ url: session.url });
  } catch (err) {
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

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, req.user.id))
    .limit(1);

  if (!user?.stripeCustomerId) {
    res.status(400).json({ error: "No Stripe customer for this user" });
    return;
  }

  try {
    const stripe = await getUncachableStripeClient();
    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: returnUrl || buildAppUrl(req, "/dashboard"),
    });
    res.json({ url: session.url });
  } catch (err) {
    req.log.error({ err }, "Failed to create billing portal session");
    res.status(500).json({ error: "Failed to create portal session" });
  }
});

export default router;
