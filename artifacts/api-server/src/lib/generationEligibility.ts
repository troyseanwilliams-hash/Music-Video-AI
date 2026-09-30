// A pending Stripe subscription is not an entitlement. Internal trial access
// requires both its explicit status and an unexpired trial window.
export function canCreateCreditFundedMedia(user: {
  subscriptionStatus?: string | null;
  trialEndsAt?: Date | string | null;
} | null | undefined, now = Date.now()): boolean {
  return user?.subscriptionStatus === "active" ||
    (user?.subscriptionStatus === "trial" &&
      !!user.trialEndsAt &&
      new Date(user.trialEndsAt).getTime() > now);
}