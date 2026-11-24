import { useEffect, useMemo, useState } from "react";
import { useLocation, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { AUTH_QUERY_KEY, useAuth } from "@/hooks/useAuth";
import { useSEO } from "@/hooks/useSEO";
import {
  buildAuthUrl,
  buildPricingIntent,
  getAuthIntent,
  normalizeAuthInterval,
  normalizeAuthPlan,
  normalizeTopupIdentifier,
  type AuthBillingInterval,
  type AuthPlan,
} from "@/lib/authIntent";
import {
  useListBillingPlans,
  useGetBillingSubscription,
  createBillingCheckout,
  createBillingPortalSession,
  getGetBillingSubscriptionQueryKey,
  getGetCreditsQueryKey,
  getGetDashboardStatsQueryKey,
  type BillingSubscriptionResponse,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { track, trackEvent } from "@/lib/analytics";
import { GENERATED_IMAGE_CREDITS_PER_VISUAL } from "@/lib/creditPricing";
import { FREE_OFFER_COPY } from "@/lib/freeOffer";
import { notifyGenerateCreditReturn } from "@/lib/generateCreditCheckout";
import {
  Check,
  Loader2,
  Zap,
  Crown,
  Sparkles,
  CreditCard,
  ArrowLeft,
  ChevronDown,
} from "lucide-react";

type Interval = AuthBillingInterval;
type PlanPrice = {
  interval: string | null;
  unitAmount: number;
  currency: string;
};

function formatPrice(amount: number, currency: string): string {
  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: amount % 100 === 0 ? 0 : 2,
  });
  return formatter.format(amount / 100);
}

function getQueryParam(name: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(name);
}

function getYearlySavings(prices: PlanPrice[]) {
  const monthly = prices.find((price) => price.interval === "month");
  const yearly = prices.find((price) => price.interval === "year");
  if (!monthly || !yearly) return null;

  const amount = monthly.unitAmount * 12 - yearly.unitAmount;
  if (amount <= 0) return null;

  return {
    amount,
    percent: Math.round((amount / (monthly.unitAmount * 12)) * 100),
  };
}

function getTopupIntentIdentifiers(
  plan: { id: string },
  price: { id: string; lookupKey: string | null },
): string[] {
  return [price.id, price.lookupKey, plan.id]
    .map((value) => normalizeTopupIdentifier(value))
    .filter((value): value is string => value !== null);
}

// Monthly included instrumentals per tier (unchanged entitlement).
const INCLUDED_INSTRUMENTALS: Record<string, number> = {
  starter: 25,
  pro: 100,
  studio: 300,
};

const TIER_ICONS: Record<string, typeof Zap> = {
  starter: Zap,
  pro: Sparkles,
  studio: Crown,
};

export default function Pricing() {
  const [, setLocation] = useLocation();
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const initialIntent = useMemo(() => getAuthIntent(), []);
  const initialPlan = initialIntent.plan;
  const [interval, setInterval] = useState<Interval>(
    initialIntent.interval ?? "month",
  );
  const [selectedPlan, setSelectedPlan] = useState<AuthPlan | null>(initialPlan);
  const [selectedTopupId, setSelectedTopupId] = useState<string | null>(
    initialIntent.topupId,
  );
  const [checkoutReady] = useState(
    initialIntent.continueCheckout &&
      Boolean(initialPlan || initialIntent.topupId),
  );
  const [busyPriceId, setBusyPriceId] = useState<string | null>(null);
  const [portalBusy, setPortalBusy] = useState(false);
  const [redeemBusy, setRedeemBusy] = useState(false);

  // Keep the choice in the pricing URL so refresh, login/register, and browser
  // back/forward all restore the same billing interval.
  useEffect(() => {
    const restoreInterval = () => {
      setInterval(getAuthIntent().interval ?? "month");
    };
    window.addEventListener("popstate", restoreInterval);
    return () => window.removeEventListener("popstate", restoreInterval);
  }, []);

  const selectInterval = (nextInterval: Interval) => {
    if (nextInterval === interval) return;
    const url = new URL(window.location.href);
    url.searchParams.set("interval", nextInterval);
    window.history.pushState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    setInterval(nextInterval);
  };

  useSEO({
    title: "Pricing",
    description:
      "Choose a credit plan for AIBeatSync music, images, narration, AI video, and clean Creator Studio exports.",
    canonical: "/pricing",
  });

  const { data: plans, isLoading: plansLoading } = useListBillingPlans();
  const { data: subscription } = useGetBillingSubscription({
    query: { queryKey: getGetBillingSubscriptionQueryKey(), enabled: isAuthenticated },
  });

  useEffect(() => {
    if (!isAuthLoading) {
      trackEvent("pricing_viewed", { authenticated: isAuthenticated });
    }
  }, [isAuthenticated, isAuthLoading]);

  useEffect(() => {
    const status = getQueryParam("status");
    notifyGenerateCreditReturn(window.location.search);
    if (status === "success") {
      trackEvent("checkout_returned", { outcome: "success" });
      toast({
        title: "Payment successful",
        description: "Thanks! Updating your credits…",
      });
      window.history.replaceState({}, "", window.location.pathname);

      const subKey = getGetBillingSubscriptionQueryKey();
      const creditsKey = getGetCreditsQueryKey();
      const statsKey = getGetDashboardStatsQueryKey();

      const initialSub =
        queryClient.getQueryData<BillingSubscriptionResponse>(subKey);
      const initialCredits = initialSub?.creditsRemaining ?? 0;
      const initialActive = initialSub?.subscriptionStatus === "active";

      const invalidateAll = () => {
        queryClient.invalidateQueries({ queryKey: subKey });
        queryClient.invalidateQueries({ queryKey: creditsKey });
        queryClient.invalidateQueries({ queryKey: statsKey });
        queryClient.invalidateQueries({ queryKey: AUTH_QUERY_KEY });
      };

      invalidateAll();

      const startedAt = Date.now();
      const intervalId = window.setInterval(() => {
        const elapsed = Date.now() - startedAt;
        const sub =
          queryClient.getQueryData<BillingSubscriptionResponse>(subKey);
        const creditsIncreased =
          (sub?.creditsRemaining ?? 0) > initialCredits;
        const becameActive =
          !initialActive && sub?.subscriptionStatus === "active";

        if (creditsIncreased || becameActive || elapsed >= 10000) {
          window.clearInterval(intervalId);
          return;
        }
        invalidateAll();
      }, 1500);

      return () => window.clearInterval(intervalId);
    } else if (status === "cancelled") {
      trackEvent("checkout_returned", { outcome: "cancelled" });
      toast({
        title: "Checkout cancelled",
        description: "No charge was made.",
      });
      window.history.replaceState({}, "", window.location.pathname);
    }
    return undefined;
  }, [toast, queryClient]);

  const subscriptions = plans?.subscriptions ?? [];
  const topups = plans?.topups ?? [];
  const selectedTopup = useMemo(() => {
    if (!selectedTopupId) return null;
    for (const plan of topups) {
      const price = plan.prices[0];
      if (!price) continue;
      const identifiers = getTopupIntentIdentifiers(plan, price);
      if (identifiers.includes(selectedTopupId)) {
        return {
          plan,
          price,
          identifier: identifiers[0] ?? selectedTopupId,
        };
      }
    }
    return null;
  }, [selectedTopupId, topups]);
  const selectedIntentLabel = selectedPlan
    ? `${selectedPlan} plan`
    : selectedTopup
      ? `${selectedTopup.price.credits.toLocaleString()}-credit pack`
      : null;

  const hasYearly = useMemo(
    () =>
      subscriptions.some((p) => p.prices.some((pr) => pr.interval === "year")),
    [subscriptions],
  );
  const annualSavings = useMemo(
    () =>
      subscriptions
        .map((plan) => getYearlySavings(plan.prices))
        .filter((saving): saving is NonNullable<typeof saving> => saving !== null)
        .sort((a, b) => b.percent - a.percent)[0] ?? null,
    [subscriptions],
  );

  const handleSubscribe = async (
    priceId: string,
    plan: string,
    billingInterval: string,
    purchaseType: "subscription" | "topup",
    topupIdentifier?: string,
  ) => {
    trackEvent("plan_selected", {
      plan,
      billing_interval: billingInterval,
      purchase_type: purchaseType,
      authenticated: isAuthenticated,
    });
    const normalizedPlan = normalizeAuthPlan(plan);
    const normalizedInterval = normalizeAuthInterval(billingInterval);
    const normalizedTopup = normalizeTopupIdentifier(
      topupIdentifier ?? (purchaseType === "topup" ? priceId : null),
    );
    if (normalizedPlan) {
      setSelectedPlan(normalizedPlan);
      setSelectedTopupId(null);
    }
    if (normalizedInterval) setInterval(normalizedInterval);
    if (normalizedTopup) {
      setSelectedTopupId(normalizedTopup);
      setSelectedPlan(null);
    }
    if (!isAuthenticated) {
      track("checkout_intent_logged_out", { priceId });
      setLocation(
        buildAuthUrl("/register", {
          plan: purchaseType === "subscription" ? normalizedPlan ?? undefined : undefined,
          interval: purchaseType === "subscription" ? normalizedInterval ?? undefined : undefined,
          topupId: purchaseType === "topup" ? normalizedTopup ?? undefined : undefined,
          referralCode: getAuthIntent().referralCode ?? undefined,
          returnTo: normalizedPlan || normalizedTopup
            ? buildPricingIntent(
                purchaseType === "subscription" ? normalizedPlan : null,
                purchaseType === "subscription" ? normalizedInterval : null,
                true,
                purchaseType === "topup" ? normalizedTopup : undefined,
              )
            : "/pricing",
          continueCheckout: Boolean(normalizedPlan || normalizedTopup),
        }),
      );
      return;
    }
    setBusyPriceId(priceId);
    track("checkout_start", { priceId });
    try {
      const result = await createBillingCheckout({ priceId });
      window.location.href = result.url;
    } catch (err) {
      toast({
        title: "Checkout failed",
        description:
          err instanceof Error ? err.message : "Could not start checkout.",
        variant: "destructive",
      });
      setBusyPriceId(null);
    }
  };

  const handleRedeemDriftPro = async () => {
    if (!isAuthenticated) {
      setLocation("/login");
      return;
    }
    setRedeemBusy(true);
    try {
      const res = await fetch("/api/billing/redeem-drift-pro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      const data = await res.json();
      if (res.ok) {
        toast({
          title: "Membership activated",
          description: data.message ?? "Your Digital Drift Pro perk is now active.",
        });
        queryClient.invalidateQueries({ queryKey: getGetBillingSubscriptionQueryKey() });
        queryClient.invalidateQueries({ queryKey: AUTH_QUERY_KEY });
      } else {
        toast({
          title: "Couldn't activate",
          description: data.error ?? "No active Digital Drift Pro subscription found for your email.",
          variant: "destructive",
        });
      }
    } catch {
      toast({ title: "Something went wrong", description: "Please try again.", variant: "destructive" });
    } finally {
      setRedeemBusy(false);
    }
  };

  const handleOpenPortal = async () => {
    setPortalBusy(true);
    try {
      const result = await createBillingPortalSession({});
      window.location.href = result.url;
    } catch (err) {
      toast({
        title: "Could not open billing portal",
        description:
          err instanceof Error ? err.message : "Please try again later.",
        variant: "destructive",
      });
      setPortalBusy(false);
    }
  };

  if (isAuthLoading || plansLoading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-6xl overflow-x-clip px-4 py-6 sm:py-8">
      <div className="mb-3 flex items-center justify-between gap-4">
        <Button variant="ghost" size="sm" onClick={() => window.history.back()}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        {isAuthenticated && subscription?.hasStripeCustomer && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleOpenPortal}
            disabled={portalBusy}
            data-testid="button-billing-portal"
          >
            {portalBusy ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <CreditCard className="mr-2 h-4 w-4" />
            )}
            Manage Billing
          </Button>
        )}
      </div>

      <div className="text-center mb-6">
        <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight mb-2">
          Choose your <span className="text-gradient-electric">plan</span>
        </h1>
        <p className="text-sm leading-6 text-muted-foreground max-w-2xl mx-auto sm:text-base">
          Subscribe for credits that refresh every billing cycle, or buy a one-time pack that never expires.
          Credits cover music, images, narration and AI video.
        </p>
        <div className="mx-auto mt-3 flex max-w-md items-start gap-2 rounded-2xl border border-primary/40 bg-primary/10 px-4 py-2 text-left text-sm font-medium sm:max-w-2xl" data-testid="text-free-offer">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <span className="min-w-0">
            <strong className="text-foreground">{FREE_OFFER_COPY.headline}</strong>
            {" "}{FREE_OFFER_COPY.expiry}
          </span>
        </div>
        {!isAuthenticated && (
          <div className="mt-3 flex flex-col items-center gap-x-3 gap-y-1 sm:flex-row sm:justify-center">
            <Link href="/register">
              <Button className="w-full sm:w-auto">Create account — get 150 credits</Button>
            </Link>
            <p className="text-xs text-muted-foreground">No credit card required to create an account.</p>
          </div>
        )}
        {checkoutReady && selectedIntentLabel && (
          <div
            role="status"
            className="mx-auto mt-3 max-w-xl rounded-xl border border-primary/40 bg-primary/10 px-4 py-3 text-sm"
            data-testid="pricing-checkout-intent"
          >
            Your {selectedIntentLabel} is ready to review. Choose{" "}
            <strong className="text-foreground">Continue to checkout</strong> below to open secure checkout;
            you will not be charged automatically.
          </div>
        )}
        {isAuthenticated && subscription && (
          <div
            className="mx-auto mt-3 flex max-w-md flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-2xl border border-border/50 bg-secondary/40 px-4 py-3 text-sm sm:inline-flex sm:max-w-none sm:rounded-full sm:py-2"
            data-testid="pricing-credits-summary"
          >
            <Zap className="h-4 w-4 text-primary" />
            <span>
              You have <strong>{subscription.creditsRemaining}</strong> credit
              {subscription.creditsRemaining === 1 ? "" : "s"} remaining
            </span>
            {(subscription.subscriptionCredits > 0 ||
              subscription.topupCredits > 0) && (
              <span className="text-muted-foreground">
                · {subscription.subscriptionCredits} plan +{" "}
                {"welcomeCredits" in subscription && typeof subscription.welcomeCredits === "number"
                  ? `${subscription.welcomeCredits} welcome (expires when your 7-day trial ends) + ${subscription.topupCredits} top-up`
                  : `${subscription.topupCredits} top-up / welcome (unused welcome credits expire when your 7-day trial ends)`}
              </span>
            )}
            {subscription.planName && (
              <span className="text-muted-foreground">
                · {subscription.planName}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="mb-3 text-center">
        <h2 className="text-xl font-bold">Subscriptions</h2>
        <p className="mx-auto max-w-xl text-sm text-muted-foreground">
          Credits refresh every billing cycle. Prefer to pay once? See credit packs below.
        </p>
      </div>
      {hasYearly && (
        <div className="mb-8 flex flex-col items-center justify-center gap-2 sm:flex-row sm:gap-3">
          {annualSavings && (
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-3.5 py-1.5 text-xs font-semibold text-primary">
              <Sparkles className="h-3.5 w-3.5" />
              Pay yearly and save {annualSavings.percent}% — about two months free
            </div>
          )}
          <div className="inline-flex rounded-lg border border-border bg-card/50 p-1" role="group" aria-label="Billing interval">
            <button
              type="button"
              onClick={() => selectInterval("month")}
              aria-pressed={interval === "month"}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                interval === "month"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              data-testid="button-interval-monthly"
            >
              Monthly
            </button>
            <button
              type="button"
              onClick={() => selectInterval("year")}
              aria-pressed={interval === "year"}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                interval === "year"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              data-testid="button-interval-yearly"
            >
              <span>Yearly</span>
              {annualSavings && (
                <span className="ml-1.5 rounded-sm bg-background/25 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide">
                  Save {annualSavings.percent}%
                </span>
              )}
            </button>
          </div>
        </div>
      )}



      {/* Digital Drift Pro perk — hidden for now */}
      {false && <section className="mb-12">
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-5 md:p-6 flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
          <div>
            <p className="text-sm font-semibold">Have a Digital Drift <span className="text-primary">Pro</span> membership?</p>
            <p className="text-sm text-muted-foreground mt-1">
              Your Pro plan includes AIBeatSync — activate it here. Use the same email you subscribed with on digitaldriftproductions.
            </p>
          </div>
          <button
            onClick={handleRedeemDriftPro}
            disabled={redeemBusy}
            className="shrink-0 rounded-lg bg-primary text-primary-foreground font-semibold px-5 py-3 text-sm hover:opacity-90 transition disabled:opacity-50"
          >
            {redeemBusy ? "Activating…" : "Activate included membership"}
          </button>
        </div>
      </section>}

      <section className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16" aria-label="Subscription plans">
        {subscriptions.map((plan) => {
          // Never silently substitute a monthly checkout when yearly is selected.
          const price = plan.prices.find((p) => p.interval === interval);
          if (!price) return null;
          const Icon = TIER_ICONS[plan.name.toLowerCase()] ?? Sparkles;
          const yearlySaving =
            price.interval === "year" ? getYearlySavings(plan.prices) : null;
          const monthlyEquivalent =
            price.interval === "year" ? price.unitAmount / 12 : null;
          const isCurrent =
            subscription?.priceLookupKey &&
            price.lookupKey === subscription.priceLookupKey;
          const isSelectedIntent =
            selectedPlan === normalizeAuthPlan(plan.name) &&
            interval === price.interval;
          const includedInstrumentals = INCLUDED_INSTRUMENTALS[plan.name.toLowerCase()];

          return (
            <Card
              key={plan.id}
               className={`relative bg-card/50 border transition-all duration-300 hover:-translate-y-1 ${
                 isSelectedIntent
                   ? "border-primary ring-2 ring-primary/50 shadow-glow"
                   : ""
               } ${
                plan.popular
                  ? "border-primary/60 shadow-glow md:scale-[1.03]"
                  : "border-card-border hover:border-primary/40 hover:shadow-glow"
              }`}
              data-testid={`card-plan-${plan.name.toLowerCase()}`}
               data-selected={isSelectedIntent ? "true" : undefined}
            >
              {plan.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-gradient-electric text-xs font-semibold text-white shadow-glow">
                  Most popular
                </div>
              )}
              <CardHeader>
                <div className="flex items-center gap-3 mb-2">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <Icon className="h-5 w-5 text-primary" />
                  </div>
                  <CardTitle className="text-2xl">{plan.name}</CardTitle>
                </div>
                <p className="text-sm text-muted-foreground">
                  {price.interval === "year"
                    ? `${price.credits.toLocaleString()} credits per year — billed annually`
                    : plan.description}
                </p>
              </CardHeader>
              <CardContent className="space-y-6">
                <div>
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-bold">
                      {formatPrice(price.unitAmount, price.currency)}
                    </span>
                    <span className="text-muted-foreground">
                      / {price.interval === "year" ? "yr" : "mo"}
                    </span>
                  </div>
                  {price.interval === "year" && (
                    <p className="mt-1 text-sm font-medium">Billed {formatPrice(price.unitAmount, price.currency)} once per year</p>
                  )}
                  <div className="mt-1 text-sm text-muted-foreground">
                    {price.credits.toLocaleString()} credits per{" "}
                    {price.interval === "year" ? "year" : "month"}
                  </div>
                  {yearlySaving && monthlyEquivalent !== null && (
                    <div className="mt-3 rounded-lg border border-primary/25 bg-primary/10 px-3 py-2 text-sm">
                      <span className="font-semibold text-primary">
                        Save {formatPrice(yearlySaving.amount, price.currency)}
                      </span>
                      <span className="text-muted-foreground"> a year · {yearlySaving.percent}% off monthly</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {formatPrice(monthlyEquivalent, price.currency)}/month effective · billed yearly
                      </span>
                    </div>
                  )}
                </div>

                <ul className="space-y-2 text-sm">
                  {includedInstrumentals !== undefined && (
                    <li className="flex items-start gap-2" data-testid={`text-instrumentals-${plan.name.toLowerCase()}`}>
                      <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                      <span>{includedInstrumentals} included instrumentals each month</span>
                    </li>
                  )}
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                    <span>Video, image, music and narration tools</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                    <span>Clean, watermark-free 1080p exports</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                    <span>Cancel or change plans anytime</span>
                  </li>
                </ul>

                <Button
                  className={`w-full ${
                    plan.popular
                      ? "bg-gradient-electric text-white shadow-glow"
                      : ""
                  }`}
                  variant={plan.popular ? "default" : "outline"}
                  disabled={busyPriceId === price.id || Boolean(isCurrent)}
                  onClick={() => handleSubscribe(
                    price.id,
                    plan.name.toLowerCase(),
                    price.interval ?? interval,
                    "subscription",
                  )}
                  data-testid={`button-subscribe-${plan.name.toLowerCase()}`}
                >
                  {busyPriceId === price.id ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                   {isCurrent
                     ? "Current plan"
                     : isAuthenticated && checkoutReady && isSelectedIntent
                       ? "Continue to checkout"
                       : isAuthenticated
                         ? price.interval === "year"
                           ? "Start yearly & save"
                           : "Subscribe monthly"
                         : "Create account to continue"}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </section>

      {topups.length > 0 && (
        <section className="mb-16" aria-labelledby="packs-heading">
          <div className="text-center mb-8">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">One-time</p>
            <h2 id="packs-heading" className="mt-1 text-2xl font-bold mb-2">Credit packs</h2>
            <p className="text-muted-foreground">
              Pay once, no subscription. Pack credits never expire and stack with any plan.
            </p>
            <div className="mx-auto mt-4 flex max-w-full flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-2xl border border-primary/40 bg-primary/10 px-4 py-2 text-sm font-medium sm:inline-flex sm:rounded-full">
              <span className="text-primary font-semibold">15% off your first pack</span>
              <span className="text-muted-foreground">with code</span>
              <code className="px-2 py-0.5 rounded bg-primary/20 text-primary font-mono font-bold tracking-wider">FIRST15</code>
              <span className="text-muted-foreground text-xs">at checkout</span>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {topups.map((plan) => {
              const price = plan.prices[0];
              if (!price) return null;
              const topupIntentIdentifiers = getTopupIntentIdentifiers(plan, price);
              const topupIdentifier = topupIntentIdentifiers[0] ?? null;
              const isSelectedTopupIntent =
                checkoutReady &&
                topupIntentIdentifiers.includes(selectedTopupId ?? "");

              // Face value: $0.02/credit = 2 cents/credit
              const faceValueCents = price.credits * 2;
              const savingsPct = faceValueCents > 0
                ? Math.round((1 - price.unitAmount / faceValueCents) * 100)
                : 0;
              const perCreditCents = price.unitAmount / 100 / price.credits;


              return (
                <Card
                  key={plan.id}
                  className={`relative bg-card/30 border ${
                    isSelectedTopupIntent
                      ? "border-primary ring-2 ring-primary/50 shadow-glow"
                      : plan.popular
                        ? "border-primary/60 shadow-glow"
                        : "border-card-border"
                  }`}
                  data-testid={`card-topup-${price.credits}`}
                  data-selected={isSelectedTopupIntent ? "true" : undefined}
                >
                  {plan.popular && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-gradient-electric text-xs font-semibold text-white shadow-glow">
                      Best value
                    </div>
                  )}
                  {savingsPct > 0 && !plan.popular && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-secondary border border-border text-xs font-semibold text-foreground">
                      Save {savingsPct}%
                    </div>
                  )}
                  <CardHeader>
                    <CardTitle className="text-xl">
                      {price.credits.toLocaleString()} credits
                    </CardTitle>
                    <p className="text-sm text-muted-foreground">
                      One-time purchase · never expires
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <div className="text-3xl font-bold">
                        {formatPrice(price.unitAmount, price.currency)}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-sm text-muted-foreground">
                          ${perCreditCents.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")} / credit
                        </span>
                        {savingsPct > 0 && (
                          <span className="text-xs font-medium text-primary">
                            {savingsPct}% off
                          </span>
                        )}
                      </div>
                    </div>
                    <Button
                      className={`w-full ${plan.popular ? "bg-gradient-electric text-white shadow-glow" : ""}`}
                      variant={plan.popular ? "default" : "outline"}
                      disabled={busyPriceId === price.id}
                      onClick={() => handleSubscribe(
                        price.id,
                        plan.name.toLowerCase(),
                        price.interval ?? "one_time",
                        "topup",
                        topupIdentifier ?? undefined,
                      )}
                      data-testid={`button-topup-${price.credits}`}
                    >
                      {busyPriceId === price.id ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : null}
                      {isAuthenticated && isSelectedTopupIntent
                        ? "Continue to checkout"
                        : isAuthenticated
                          ? "Buy now"
                          : "Create account to continue"}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      )}

      <section className="mb-12" aria-labelledby="pricing-details-heading" data-testid="section-pricing-details">
        <h2 id="pricing-details-heading" className="mb-4 text-center text-xl font-bold sm:text-2xl">Details and policies</h2>
        <div className="mx-auto max-w-3xl divide-y divide-border rounded-2xl border border-border bg-card/40">
          {[
            {
              id: "tools",
              title: "What credits pay for",
              body: [
                `AI image generation: ${GENERATED_IMAGE_CREDITS_PER_VISUAL} credits per generated image, limited only by your credit balance.`,
                "Credit-based beat-synced AI music videos and narrative, story-led videos for long-form YouTube content.",
                "AI Music: paid plans include a monthly number of instrumentals (shown on each plan). Additional instrumentals and vocal songs use credits.",
                "AI Narration: 3 credits per started 1,000 script characters, 3-credit minimum. An AI-generated music bed is included.",
                "Use your own background music at no extra music-generation charge: choose music from AIBeatSync, upload audio, import a Suno song, or use voice only.",
                "Generation costs vary by model, length and settings, so credit packs do not map to a fixed number of clips.",
              ],
            },
            {
              id: "studio",
              title: "Creator Studio exports",
              body: [
                "Unlimited clean Creator Studio exports during your trial and while subscribed. Expired non-paid accounts get 10 free exports per calendar month, then 15 credits each.",
                "Trial karaoke lyric-burn exports cost credits; Auto-sync aligns cost credits per run. Paid subscribers retain their plan's Creator Studio features.",
                "All paid plans include TikTok/Shorts teaser cuts, Spotify Canvas exports, and watermark-free 1080p Full HD downloads.",
              ],
            },
            {
              id: "free",
              title: "Free 150 credits and trial terms",
              body: [
                FREE_OFFER_COPY.headline,
                FREE_OFFER_COPY.example,
                FREE_OFFER_COPY.expiry,
                FREE_OFFER_COPY.videoExample,
                FREE_OFFER_COPY.music,
                FREE_OFFER_COPY.trialExtras,
                FREE_OFFER_COPY.afterTrial,
                FREE_OFFER_COPY.credits,
                FREE_OFFER_COPY.paid,
              ],
            },
            {
              id: "billing",
              title: "Billing, renewals and cancellation",
              body: [
                "Subscriptions renew automatically each month or year. Plan credits refresh with your billing cycle.",
                "Yearly plans are billed once per year for the full annual credit amount shown.",
                "Credit packs are one-time purchases. Top-up credits never expire.",
                "Cancel or change plans anytime from Manage Billing.",
              ],
            },
          ].map((item) => (
            <details key={item.id} className="group px-4 sm:px-5" data-testid={`details-${item.id}`}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-4 text-sm font-semibold [&::-webkit-details-marker]:hidden">
                <span>{item.title}</span>
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
              </summary>
              <ul className="space-y-2 pb-4 text-sm leading-6 text-muted-foreground">
                {item.body.map((line) => (
                  <li key={line} className="flex gap-2 break-words">
                    <Check className="mt-1 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                    <span className="min-w-0">{line}</span>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      </section>
      <div className="text-center text-sm text-muted-foreground">
        Need a custom plan?{" "}
        <Link href="/" className="text-primary hover:underline">
          Get in touch
        </Link>
        .
      </div>
    </div>
  );
}
