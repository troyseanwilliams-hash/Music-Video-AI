import Stripe from "stripe";
import { getUncachableStripeClient } from "./stripeClient.js";

// ── Pricing constants (keep in sync with creditCost.ts) ────────────────────
// RUNWAY_USD_PER_TOKEN = $0.01  →  $10 per 1000 Runway tokens
// USD_PER_CREDIT       = $0.02  →  1 credit = 1 Runway token, sold at 2×
// MARKUP               = 2      →  customers pay 2× Runway cost per video
//
// Video credit costs (MARKUP=2, USD_PER_CREDIT=0.02):
//   5s clip : ceil(330 × 0.01 × 2 / 0.02) = 330 credits  ($6.60)
//  10s clip : ceil(660 × 0.01 × 2 / 0.02) = 660 credits  ($13.20)
//  Full (3×10s): 1980 credits ($39.60)
//
// Top-up bundle math (Stripe fee = 2.9% + $0.30):
//   Starter  1000cr @ $20.00  →  $0.020/cr (face value), Stripe fee ~4.4%
//   Growth   5000cr @ $85.00  →  $0.017/cr (15% off),   Stripe fee ~3.3%
//   Studio  20000cr @ $300.00 →  $0.015/cr (25% off),   Stripe fee ~2.9%

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
  // Credits scaled so subscribers get equivalent video value vs old pricing.
  // Old: 5s video = 50 credits; New: 5s video = 330 credits (6.6× scale).
  {
    name: "Starter",
    description: "400 credits per month — best for casual creators",
    metadata: { tier: "starter", kind: "subscription" },
    prices: [
      {
        nickname: "Starter Monthly",
        unitAmount: 900,
        currency: "usd",
        recurring: { interval: "month" },
        credits: 400,
        lookupKey: "starter_monthly",
      },
      {
        nickname: "Starter Yearly",
        unitAmount: 9000,
        currency: "usd",
        recurring: { interval: "year" },
        credits: 4800,
        lookupKey: "starter_yearly",
      },
    ],
  },
  {
    name: "Pro",
    description: "1650 credits per month — for serious creators",
    metadata: { tier: "pro", kind: "subscription", popular: "true" },
    prices: [
      {
        nickname: "Pro Monthly",
        unitAmount: 2900,
        currency: "usd",
        recurring: { interval: "month" },
        credits: 1650,
        lookupKey: "pro_monthly",
      },
      {
        nickname: "Pro Yearly",
        unitAmount: 29000,
        currency: "usd",
        recurring: { interval: "year" },
        credits: 19800,
        lookupKey: "pro_yearly",
      },
    ],
  },
  {
    name: "Studio",
    description: "5000 credits per month — for production teams",
    metadata: { tier: "studio", kind: "subscription" },
    prices: [
      {
        nickname: "Studio Monthly",
        unitAmount: 7900,
        currency: "usd",
        recurring: { interval: "month" },
        credits: 5000,
        lookupKey: "studio_monthly",
      },
      {
        nickname: "Studio Yearly",
        unitAmount: 79000,
        currency: "usd",
        recurring: { interval: "year" },
        credits: 60000,
        lookupKey: "studio_yearly",
      },
    ],
  },

  // ── Credit Packs (one-time top-ups) ────────────────────────────────────────
  // Face value: $0.02/credit ($20 per 1000) = 2× Runway cost.
  // Larger packs get volume discounts to reduce Stripe fee impact.
  {
    name: "Credit Pack — Starter",
    description: "1,000 credits · one-time purchase · never expires",
    metadata: { kind: "topup" },
    prices: [
      {
        nickname: "1000 Credits",
        unitAmount: 2000,  // $20.00 — $0.020/credit (face value)
        currency: "usd",
        credits: 1000,
        lookupKey: "topup_1000",
      },
    ],
  },
  {
    name: "Credit Pack — Growth",
    description: "5,000 credits · one-time purchase · never expires · save 15%",
    metadata: { kind: "topup", popular: "true" },
    prices: [
      {
        nickname: "5000 Credits",
        unitAmount: 8500,  // $85.00 — $0.017/credit (15% off face value)
        currency: "usd",
        credits: 5000,
        lookupKey: "topup_5000",
      },
    ],
  },
  {
    name: "Credit Pack — Studio",
    description: "20,000 credits · one-time purchase · never expires · save 25%",
    metadata: { kind: "topup" },
    prices: [
      {
        nickname: "20000 Credits",
        unitAmount: 30000,  // $300.00 — $0.015/credit (25% off face value)
        currency: "usd",
        credits: 20000,
        lookupKey: "topup_20000",
      },
    ],
  },
];

async function archiveOldTopups(stripe: Stripe): Promise<void> {
  const oldLookupKeys = [
    "topup_50", "topup_200", "topup_600",  // v1 buckets
    "topup_100", "topup_500", "topup_2000", // v2 buckets
  ];
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

async function seedFirstPurchasePromo(stripe: Stripe): Promise<void> {
  const promoCode = "FIRST15";
  const couponName = "15% off first credit pack purchase";

  // Deactivate old FIRST25 code if it exists
  const old25 = await stripe.promotionCodes.list({ code: "FIRST25", active: true, limit: 1 });
  if (old25.data.length > 0) {
    await stripe.promotionCodes.update(old25.data[0]!.id, { active: false });
    console.log(`- Deactivated old promo code: FIRST25`);
  }

  // Check if new promo code already exists
  const existing = await stripe.promotionCodes.list({ code: promoCode, active: true, limit: 1 });
  if (existing.data.length > 0) {
    console.log(`✓ Promo code exists: ${promoCode} (${existing.data[0]!.id})`);
    return;
  }

  // Create the coupon
  const coupon = await stripe.coupons.create({
    name: couponName,
    percent_off: 15,
    duration: "once",
    currency: "usd",
    applies_to: { products: [] },
  });
  console.log(`+ Created coupon: ${couponName} (${coupon.id})`);

  // Create the promo code restricted to first-time customers
  const promo = await stripe.promotionCodes.create({
    coupon: coupon.id,
    code: promoCode,
    restrictions: { first_time_transaction: true },
  });
  console.log(`+ Created promo code: ${promoCode} (${promo.id}) — 15% off, first purchase only`);
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

  console.log("\nSeeding first-purchase promo code…");
  await seedFirstPurchasePromo(stripe);

  console.log("\n✓ All products and prices are in place.");
  console.log(
    "Webhooks managed by stripe-replit-sync will populate the local stripe schema automatically.",
  );

  console.log("\n── Credit Pack summary ──");
  console.log("  Face value: $0.02/credit  ($20 per 1000 credits = 2× Runway cost)");
  console.log("  Starter   1000cr  $20.00  →  $0.020/cr  (Stripe fee ~4.4%)  face value");
  console.log("  Growth    5000cr  $85.00  →  $0.017/cr  (Stripe fee ~3.3%)  15% off");
  console.log("  Studio   20000cr $300.00  →  $0.015/cr  (Stripe fee ~2.9%)  25% off");
  console.log("\n── Video cost at MARKUP=2 ──");
  console.log("   5s clip :  330 credits  ($6.60 / Runway cost $3.30)");
  console.log("  10s clip :  660 credits  ($13.20 / Runway cost $6.60)");
  console.log("  Full(3×10s): 1980 credits ($39.60 / Runway cost $19.80)");
}

main().catch((err) => {
  console.error("Failed to seed products:", err);
  process.exit(1);
});
