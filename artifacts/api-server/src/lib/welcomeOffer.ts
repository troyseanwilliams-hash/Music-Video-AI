// Only accounts created after this change receive this seven-day signup grant.
// Historical welcome grants stay in their original bucket; never retroactively
// take credits from topups, which can also contain real purchases.
export const WELCOME_CREDITS = 150;
export function welcomeCreditExpiry(owner: { createdAt: Date; trialEndsAt: Date | null }): string | null {
  if (!owner.trialEndsAt) return null;
  return new Date(Math.min(
    owner.createdAt.getTime() + 7 * 24 * 60 * 60 * 1000,
    owner.trialEndsAt.getTime(),
  )).toISOString();
}
export const WELCOME_OFFER_COPY = "150 welcome credits, available for your first 7 days — enough to try images, music or a short video. Actual usage varies by model and settings.";