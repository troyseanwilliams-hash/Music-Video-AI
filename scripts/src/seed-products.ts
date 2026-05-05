import Stripe from "stripe";
import { getUncachableStripeClient } from "./stripeClient.js";

// ── Pricing constants (keep in sync with creditCost.ts) ────────────────────
// Each credit = $0.10 face value (MARKUP = 1.5 over Runway cost)
// Bundles offer volume discounts to drive down the Stripe $0.30 flat fee impact.
//
// Bundle math (Stripe fee = 2.9% + $0.30):
//   Starter  100cr @ $10.00 → $0.10/cr, Stripe fee 5.9% of revenue
//   Growth   500cr @ $44.00 → $0.088/cr (12% off), Stripe fee 3.4%
//   Studio  2000cr @ $160.00 → $0.08/cr (20% off), Stripe fee 3.2%

interface PriceSpec {
  nickname: string;
  unitAmount: number;
  currency: string;
  recurring?: { interval: "month" | "year" };
  credits: number;
  lookupKey: string;
}

interface ProductSpec {
  name: string;
  description: string;
  metadata: Record<string, string>;
  prices: PriceSpec[];
}

const PRODUCTS: ProductSpec[] = [
  // ── Subscriptions ──────────────────────────────────────────────────────────
  {
    name: "Starter",
    description: "60 credits per month — best for casual creators",
    metadata: { tier: "starter", kind: "subscription" },
    prices: [
      {
        nickname: "Starter Monthly",
        unitAmount: 900,
        currency: "usd",
        recurring: { interval: "month" },
        credits: 60,
        lookupKey: "starter_monthly",
      },
      {
        nickname: "Starter Yearly",
        unitAmount: 9000,
        currency: "usd",
        recurring: { interval: "year" },
        credits: 720,
        lookupKey: "starter_yearly",
      },
    ],
  },
  {
    name: "Pro",
    description: "250 credits per month — for serious creators",
    metadata: { tier: "pro", kind: "subscription", popular: "true" },
    prices: [
      {
        nickname: "Pro Monthly",
        unitAmount: 2900,
        currency: "usd",
        recurring: { interval: "month" },
        credits: 250,
        lookupKey: "pro_monthly",
      },
      {
        nickname: "Pro Yearly",
        unitAmount: 29000,
        currency: "usd",
        recurring: { interval: "year" },
        credits: 3000,
        lookupKey: "pro_yearly",
      },
    ],
  },
  {
    name: "Studio",
    description: "800 credits per month — for production teams",
    metadata: { tier: "studio", kind: "subscription" },
    prices: [
      {
        nickname: "Studio Monthly",
        unitAmount: 7900,
        currency: "usd",
        recurring: { interval: "month" },
        credits: 800,
        lookupKey: "studio_monthly",
      },
      {
        nickname: "Studio Yearly",
        unitAmount: 79000,
        currency: "usd",
        recurring: { interval: "year" },
        credits: 9600,
        lookupKey: "studio_yearly",
      },
    ],
  },

  // ── Credit Buckets (one-time top-ups) ──────────────────────────────────────
  // Priced to amortize Stripe's $0.30 flat fee across more credits.
  // Larger buckets = lower effective Stripe fee % = better margin for us.
  {
    name: "Credit Pack — Starter",
    description: "100 credits · one-time purchase · never expires",
    metadata: { kind: "topup" },
    prices: [
      {
        nickname: "100 Credits",
        unitAmount: 1000,   // $10.00 — $0.10/credit (face value)
        currency: "usd",
        credits: 100,
        lookupKey: "topup_100",
      },
    ],
  },
  {
    name: "Credit Pack — Growth",
    description: "500 credits · one-time purchase · never expires · save 12%",
    metadata: { kind: "topup", popular: "true" },
    prices: [
      {
        nickname: "500 Credits",
        unitAmount: 4400,   // $44.00 — $0.088/credit (12% off face value)
        currency: "usd",
        credits: 500,
        lookupKey: "topup_500",
      },
    ],
  },
  {
    name: "Credit Pack — Studio",
    description: "2000 credits · one-time purchase · never expires · save 20%",
    metadata: { kind: "topup" },
    prices: [
      {
        nickname: "2000 Credits",
        unitAmount: 16000,  // $160.00 — $0.08/credit (20% off face value)
        currency: "usd",
        credits: 2000,
        lookupKey: "topup_2000",
      },
    ],
  },
];

async function archiveOldTopups(stripe: Stripe): Promise<void> {
  const oldLookupKeys = ["topup_50", "topup_200", "topup_600"];
  for (const key of oldLookupKeys) {
    const existing = await stripe.prices.list({
      lookup_keys: [key],
      active: true,
      limit: 1,
    });
    if (existing.data.length > 0) {
      const price = existing.data[0]!;
      await stripe.prices.update(price.id, { active: false });
      console.log(`- Archived old price: ${key} (${price.id})`);
      // Archive the product if it has no other active prices
      const remaining = await stripe.prices.list({
        product: price.product as string,
        active: true,
        limit: 1,
      });
      if (remaining.data.length === 0) {
        await stripe.products.update(price.product as string, { active: false });
        console.log(`- Archived old product for: ${key}`);
      }
    }
  }
}

async function findOrCreateProduct(
  stripe: Stripe,
  spec: ProductSpec,
): Promise<Stripe.Product> {
  const existing = await stripe.products.search({
    query: `name:'${spec.name}' AND active:'true'`,
    limit: 1,
  });

  if (existing.data.length > 0) {
    const product = existing.data[0]!;
    await stripe.products.update(product.id, {
      description: spec.description,
      metadata: spec.metadata,
    });
    console.log(`✓ Product exists: ${spec.name} (${product.id})`);
    return product;
  }

  const created = await stripe.products.create({
    name: spec.name,
    description: spec.description,
    metadata: spec.metadata,
  });
  console.log(`+ Created product: ${spec.name} (${created.id})`);
  return created;
}

async function findOrCreatePrice(
  stripe: Stripe,
  productId: string,
  spec: PriceSpec,
): Promise<Stripe.Price> {
  const existingByLookup = await stripe.prices.list({
    lookup_keys: [spec.lookupKey],
    active: true,
    limit: 1,
  });

  if (existingByLookup.data.length > 0) {
    const price = existingByLookup.data[0]!;
    await stripe.prices.update(price.id, {
      nickname: spec.nickname,
      metadata: { credits: String(spec.credits) },
    });
    console.log(`✓ Price exists: ${spec.lookupKey} (${price.id})`);
    return price;
  }

  const params: Stripe.PriceCreateParams = {
    product: productId,
    unit_amount: spec.unitAmount,
    currency: spec.currency,
    nickname: spec.nickname,
    lookup_key: spec.lookupKey,
    metadata: { credits: String(spec.credits) },
  };
  if (spec.recurring) {
    params.recurring = { interval: spec.recurring.interval };
  }

  const created = await stripe.prices.create(params);
  console.log(`+ Created price: ${spec.lookupKey} (${created.id})`);
  return created;
}

async function main(): Promise<void> {
  const stripe = await getUncachableStripeClient();
  console.log("Seeding products & prices into Stripe…\n");

  console.log("Archiving old topup products…");
  await archiveOldTopups(stripe);
  console.log();

  for (const productSpec of PRODUCTS) {
    const product = await findOrCreateProduct(stripe, productSpec);
    for (const priceSpec of productSpec.prices) {
      await findOrCreatePrice(stripe, product.id, priceSpec);
    }
  }

  console.log("\n✓ All products and prices are in place.");
  console.log(
    "Webhooks managed by stripe-replit-sync will populate the local stripe schema automatically.",
  );

  console.log("\n── Credit Pack summary ──");
  console.log("  Starter  100cr  $10.00  →  $0.100/cr  (Stripe fee ~5.9%)");
  console.log("  Growth   500cr  $44.00  →  $0.088/cr  (Stripe fee ~3.4%)  12% off");
  console.log("  Studio  2000cr $160.00  →  $0.080/cr  (Stripe fee ~3.2%)  20% off");
}

main().catch((err) => {
  console.error("Failed to seed products:", err);
  process.exit(1);
});
