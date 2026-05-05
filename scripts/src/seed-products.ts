import Stripe from "stripe";
import { getUncachableStripeClient } from "./stripeClient.js";

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
  {
    name: "Top-up: 50 credits",
    description: "One-time top-up of 50 credits",
    metadata: { kind: "topup" },
    prices: [
      {
        nickname: "50 Credits Top-Up",
        unitAmount: 900,
        currency: "usd",
        credits: 50,
        lookupKey: "topup_50",
      },
    ],
  },
  {
    name: "Top-up: 200 credits",
    description: "One-time top-up of 200 credits",
    metadata: { kind: "topup" },
    prices: [
      {
        nickname: "200 Credits Top-Up",
        unitAmount: 2900,
        currency: "usd",
        credits: 200,
        lookupKey: "topup_200",
      },
    ],
  },
  {
    name: "Top-up: 600 credits",
    description: "One-time top-up of 600 credits",
    metadata: { kind: "topup" },
    prices: [
      {
        nickname: "600 Credits Top-Up",
        unitAmount: 7900,
        currency: "usd",
        credits: 600,
        lookupKey: "topup_600",
      },
    ],
  },
];

async function findOrCreateProduct(
  stripe: Stripe,
  spec: ProductSpec,
): Promise<Stripe.Product> {
  const existing = await stripe.products.search({
    query: `name:'${spec.name}' AND active:'true'`,
    limit: 1,
  });

  if (existing.data.length > 0) {
    const product = existing.data[0];
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
    const price = existingByLookup.data[0];
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
}

main().catch((err) => {
  console.error("Failed to seed products:", err);
  process.exit(1);
});
