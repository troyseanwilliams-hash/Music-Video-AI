import { getUncachableStripeClient } from "./stripeClient.js";

// Subscription tier (starter/pro/studio) resolved from the Stripe subscription's
// price lookup_key. Returns null for non-subscribers / on any error.
export async function getUserTier(user: { stripeSubscriptionId?: string | null }): Promise<string | null> {
  if (!user?.stripeSubscriptionId) return null;
  try {
    const stripe = await getUncachableStripeClient();
    const sub = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);
    const lk = sub.items.data[0]?.price?.lookup_key ?? null;
    if (!lk) return null;
    for (const t of ["studio", "pro", "starter"]) if (lk.startsWith(t)) return t;
    return null;
  } catch {
    return null;
  }
}

// 4K rendering is a premium tier — Pro & Studio only (admins always allowed).
export function canRender4k(tier?: string | null): boolean {
  const t = (tier ?? "").toLowerCase();
  return t === "pro" || t === "studio";
}
