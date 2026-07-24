import { useEffect, useMemo, useState } from "react";
import { useLocation, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { AUTH_QUERY_KEY, useAuth } from "@/hooks/useAuth";
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
import {
  Check,
  Loader2,
  Zap,
  Crown,
  Sparkles,
  CreditCard,
  ArrowLeft,
} from "lucide-react";

type Interval = "month" | "year";

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

  const [interval, setInterval] = useState<Interval>("month");
  const [busyPriceId, setBusyPriceId] = useState<string | null>(null);
  const [portalBusy, setPortalBusy] = useState(false);
  const [redeemBusy, setRedeemBusy] = useState(false);

  const { data: plans, isLoading: plansLoading } = useListBillingPlans();
  const { data: subscription } = useGetBillingSubscription({
    query: { queryKey: getGetBillingSubscriptionQueryKey(), enabled: isAuthenticated },
  });

  useEffect(() => {
    const status = getQueryParam("status");
    if (status === "success") {
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

  const hasYearly = useMemo(
    () =>
      subscriptions.some((p) => p.prices.some((pr) => pr.interval === "year")),
    [subscriptions],
  );

  const handleSubscribe = async (priceId: string) => {
    if (!isAuthenticated) {
      setLocation("/login");
      return;
    }
    setBusyPriceId(priceId);
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
    <div className="container mx-auto px-4 py-12 max-w-6xl">
      <div className="mb-6 flex items-center justify-between gap-4">
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

      <div className="text-center mb-12">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary mb-4">
          <Zap className="h-3.5 w-3.5" />
          Simple, credit-based pricing
        </div>
        <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight mb-4">
          Choose your <span className="text-gradient-electric">plan</span>
        </h1>
        <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
          Credits are consumed per video generated — from{" "}
          <strong className="text-foreground">80 credits</strong> for a
          5-second clip on Runway. Pick your engine at generation:{" "}
          <strong className="text-foreground">Runway</strong> (premium) or{" "}
          <strong className="text-foreground">Kling</strong> (value — about 40%
          cheaper). Full-length videos scale with song length (up to 10 minutes).
          Render in 720p, 1080p HD (×1.25), or 4K Ultra (×2.45, Pro &amp; Studio).
          TikTok teaser packs cost 30, Spotify Canvas loops 20. Plan credits
          reset each cycle — top-up credits never expire, and you can earn more
          by referring friends.
        </p>
        {isAuthenticated && subscription && (
          <div
            className="mt-4 inline-flex items-center gap-2 rounded-full border border-border/50 bg-secondary/40 px-4 py-2 text-sm"
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
                {subscription.topupCredits} top-up
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

      {hasYearly && (
        <div className="flex items-center justify-center mb-10">
          <div className="inline-flex rounded-lg border border-border bg-card/50 p-1">
            <button
              type="button"
              onClick={() => setInterval("month")}
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
              onClick={() => setInterval("year")}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                interval === "year"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              data-testid="button-interval-yearly"
            >
              Yearly <span className="text-xs opacity-70">(save ~17%)</span>
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
              Your Pro plan includes AI Beat Sync — activate it here. Use the same email you subscribed with on digitaldriftproductions.
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

      <section className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
        {subscriptions.map((plan) => {
          const price =
            plan.prices.find((p) => p.interval === interval) ??
            plan.prices.find((p) => p.interval === "month") ??
            plan.prices[0];
          if (!price) return null;
          const Icon = TIER_ICONS[plan.name.toLowerCase()] ?? Sparkles;
          const soundtracksPerMonth =
            ({ starter: 25, pro: 100, studio: 300 } as Record<string, number>)[plan.name.toLowerCase()] ?? 25;
          const isCurrent =
            subscription?.priceLookupKey &&
            price.lookupKey === subscription.priceLookupKey;

          return (
            <Card
              key={plan.id}
              className={`relative bg-card/50 border transition-all duration-300 hover:-translate-y-1 ${
                plan.popular
                  ? "border-primary/60 shadow-glow md:scale-[1.03]"
                  : "border-card-border hover:border-primary/40 hover:shadow-glow"
              }`}
              data-testid={`card-plan-${plan.name.toLowerCase()}`}
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
                  {plan.description}
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
                  <div className="mt-1 text-sm text-muted-foreground">
                    {price.credits} credits per{" "}
                    {price.interval === "year" ? "year" : "month"}
                  </div>
                </div>

                <ul className="space-y-2 text-sm">
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                    <span>
                      {price.credits.toLocaleString()} credits per{" "}
                      {price.interval === "year" ? "year" : "month"}{" "}
                      <span className="text-muted-foreground">
                        (~{Math.floor(price.credits / 280)} full videos or{" "}
                        {Math.floor(price.credits / 50)} × 5s clips)
                      </span>
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                    <span>Beat-synced AI music videos</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                    <span>
                      <strong>{soundtracksPerMonth} free AI Soundtracks</strong>/month{" "}
                      <span className="ml-1 rounded-full bg-primary/20 text-primary text-[10px] font-semibold px-1.5 py-0.5 align-middle">Beta</span>
                      {" "}— royalty-free instrumentals for your videos{" "}
                      <span className="text-muted-foreground">(3 free to try on signup; extra tracks from 5 credits)</span>
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                    <span>
                      <strong>Unlimited</strong> Remix Lab exports — arrange clips, photos &amp; music with
                      transitions (free plan: 10 exports/month, then 15 credits each)
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                    <span>Karaoke lyric sync (LRC &amp; word-level timing)</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                    <span>TikTok/Shorts teaser cuts &amp; Spotify Canvas exports</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                    <span>Watermark-free 1080p exports</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                    <span>Full HD downloads</span>
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
                  onClick={() => handleSubscribe(price.id)}
                  data-testid={`button-subscribe-${plan.name.toLowerCase()}`}
                >
                  {busyPriceId === price.id ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  {isCurrent
                    ? "Current plan"
                    : isAuthenticated
                      ? "Subscribe"
                      : "Sign in to subscribe"}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </section>

      {topups.length > 0 && (
        <section className="mb-16">
          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold mb-2">Credit packs</h2>
            <p className="text-muted-foreground">
              One-time purchase · credits never expire · bigger packs = lower cost per video
            </p>
            <div className="inline-flex items-center gap-2 mt-4 px-4 py-2 rounded-full border border-primary/40 bg-primary/10 text-sm font-medium">
              <span className="text-primary font-semibold">15% off your first pack</span>
              <span className="text-muted-foreground">— use code</span>
              <code className="px-2 py-0.5 rounded bg-primary/20 text-primary font-mono font-bold tracking-wider">FIRST15</code>
              <span className="text-muted-foreground text-xs">at checkout</span>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {topups.map((plan) => {
              const price = plan.prices[0];
              if (!price) return null;

              // Face value: $0.02/credit = 2 cents/credit
              const faceValueCents = price.credits * 2;
              const savingsPct = faceValueCents > 0
                ? Math.round((1 - price.unitAmount / faceValueCents) * 100)
                : 0;
              const perCreditCents = price.unitAmount / 100 / price.credits;
              const estClips = Math.floor(price.credits / 60); // 10s clip = 60 credits

              return (
                <Card
                  key={plan.id}
                  className={`relative bg-card/30 border ${plan.popular ? "border-primary/60 shadow-glow" : "border-card-border"}`}
                  data-testid={`card-topup-${price.credits}`}
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
                      ≈ {estClips} × 10s clips · never expires
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
                      onClick={() => handleSubscribe(price.id)}
                      data-testid={`button-topup-${price.credits}`}
                    >
                      {busyPriceId === price.id ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : null}
                      Buy now
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      )}

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
