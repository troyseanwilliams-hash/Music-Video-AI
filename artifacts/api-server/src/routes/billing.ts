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

// ── In-memory cache for billing plans (60 s TTL) ─────────────────────────────
let plansCache: { data: unknown; expiresAt: number } | null = null;
const PLANS_CACHE_TTL_MS = 60_000;

router.get("/billing/plans", async (req, res) => {
  try {
    // Return cached data if still fresh
    if (plansCache && Date.now() < plansCache.expiresAt) {
      res.json(plansCache.data);
      return;
    }

    const stripe = await getUncachableStripeClient();

    // Two parallel Stripe calls — one round-trip total:
    // 1. All active recurring prices (subscriptions) with product expanded
    // 2. Topup prices by lookup key (bypasses product active-status)
    const [recurringPrices, topupPrices] = await Promise.all([
      stripe.prices.list({
        active: true,
        limit: 100,
        type: "recurring",
        expand: ["data.product"],
      }),
      stripe.prices.list({
        lookup_keys: [...TOPUP_LOOKUP_KEYS],
        active: true,
        limit: 20,
      }),
    ]);

    type PriceEntry = {
      id: string;
      lookupKey: string | null;
      nickname: string | null;
      unitAmount: number;
      currency: string;
      credits: number;
      interval: string | null;
    };

    // ── Build subscriptions from recurring prices ───────────────────────────
    const subscriptionMap = new Map<
      string,
      {
        id: string;
        name: string;
        description: string | null;
        popular: boolean;
        prices: PriceEntry[];
      }
    >();

    for (const price of recurringPrices.data) {
      if (price.unit_amount === null) continue;
      const product =
        typeof price.product === "string"
          ? null
          : (price.product as import("stripe").default.Product);
      if (!product || product.active === false) continue;

      const priceEntry: PriceEntry = {
        id: price.id,
        lookupKey: price.lookup_key ?? null,
        nickname: price.nickname ?? null,
        unitAmount: price.unit_amount,
        currency: price.currency,
        credits: parseCredits(price.metadata),
        interval: price.recurring?.interval ?? null,
      };

      if (!subscriptionMap.has(product.id)) {
        subscriptionMap.set(product.id, {
          id: product.id,
          name: product.name,
          description: product.description ?? null,
          popular: product.metadata?.["popular"] === "true",
          prices: [],
        });
      }
      subscriptionMap.get(product.id)!.prices.push(priceEntry);
    }

    // Sort each product's prices: monthly first, then yearly
    for (const sub of subscriptionMap.values()) {
      sub.prices.sort((a, b) => {
        const order = { month: 0, year: 1 };
        return (
          (order[a.interval as keyof typeof order] ?? 99) -
          (order[b.interval as keyof typeof order] ?? 99)
        );
      });
    }

    const subscriptions = [...subscriptionMap.values()].map((s) => ({
      ...s,
      kind: "subscription" as const,
    }));

    // ── Build topups from lookup-key prices ──────────────────────────────────
    const topups: Array<{
      id: string;
      name: string;
      description: string | null;
      kind: "topup";
      popular: boolean;
      prices: PriceEntry[];
    }> = [];

    for (const price of topupPrices.data) {
      if (!price.lookup_key || price.unit_amount === null) continue;
      const meta = TOPUP_META[price.lookup_key];
      if (!meta) continue;
      topups.push({
        id: price.id,
        name: meta.name,
        description: meta.description,
        popular: meta.popular,
        kind: "topup",
        prices: [
          {
            id: price.id,
            lookupKey: price.lookup_key,
            nickname: price.nickname ?? null,
            unitAmount: price.unit_amount,
            currency: price.currency,
            credits: parseCredits(price.metadata),
            interval: null,
          },
        ],
      });
    }

    const tierOrder = ["starter", "pro", "studio"];
    subscriptions.sort((a, b) => {
      const ai = tierOrder.indexOf(a.name.toLowerCase());
      const bi = tierOrder.indexOf(b.name.toLowerCase());
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });
    topups.sort(
      (a, b) =>
        (a.prices[0]?.unitAmount ?? 0) - (b.prices[0]?.unitAmount ?? 0),
    );

    const responseData = { subscriptions, topups };
    plansCache = { data: responseData, expiresAt: Date.now() + PLANS_CACHE_TTL_MS };
    res.json(responseData);
  } catch (err) {
    req.log.error({ err }, "Failed to list billing plans");
    res.status(500).json({ error: "Failed to load plans" });
  }
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

  const { priceId, successUrl, cancelUrl } = req.body as {
    priceId?: string;
    successUrl?: string | null;
    cancelUrl?: string | null;
  };

  if (!priceId || typeof priceId !== "string") {
    res.status(400).json({ error: "priceId is required" });
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

    const price = await stripe.prices.retrieve(priceId);
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
