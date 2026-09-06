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
import { track, trackEvent } from "@/lib/analytics";
import { GENERATED_IMAGE_CREDITS_PER_VISUAL } from "@/lib/creditPricing";
import {
  Check,
  Loader2,
  Zap,
  Crown,
  Sparkles,
  CreditCard,
  ArrowLeft,
  Music2,
  ImageIcon,
  Youtube,
  Mic2,
} from "lucide-react";

type Interval = "month" | "year";
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
    if (!isAuthLoading) {
      trackEvent("pricing_viewed", { authenticated: isAuthenticated });
    }
  }, [isAuthenticated, isAuthLoading]);

  useEffect(() => {
    const status = getQueryParam("status");
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
  ) => {
    trackEvent("plan_selected", {
      plan,
      billing_interval: billingInterval,
      purchase_type: purchaseType,
      authenticated: isAuthenticated,
    });
    if (!isAuthenticated) {
      track("checkout_intent_logged_out", { priceId });
      setLocation("/login");
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

      <div className="text-center mb-10 sm:mb-12">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary mb-4">
          <Zap className="h-3.5 w-3.5" />
          Simple, credit-based pricing
        </div>
        <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight mb-4">
          Choose your <span className="text-gradient-electric">plan</span>
        </h1>
        <p className="text-base leading-7 text-muted-foreground max-w-xl mx-auto sm:text-lg">
          Pick the credits that fit your output. Every plan includes music, narration, AI images, narrative video,
          Podcast Media, Montage Studio, and a free 7-day trial. Plan credits refresh with your billing cycle; top-ups never expire.
        </p>
        <div className="mx-auto mt-5 flex max-w-md items-start gap-2 rounded-2xl border border-primary/40 bg-primary/10 px-4 py-3 text-left text-sm font-medium sm:inline-flex sm:max-w-none sm:items-center sm:rounded-full sm:py-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span>
            Every new account gets a{" "}
            <strong className="text-foreground">free 7-day trial</strong> with{" "}
            <strong className="text-foreground">unlimited Montage Studio exports</strong>
            {" "}— no credit card required
          </span>
        </div>
        {isAuthenticated && subscription && (
          <div
            className="mx-auto mt-4 flex max-w-md flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-2xl border border-border/50 bg-secondary/40 px-4 py-3 text-sm sm:inline-flex sm:max-w-none sm:rounded-full sm:py-2"
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
        <div className="mb-10 flex flex-col items-center justify-center gap-3">
          {annualSavings && (
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-3.5 py-1.5 text-xs font-semibold text-primary">
              <Sparkles className="h-3.5 w-3.5" />
              Pay yearly and save {annualSavings.percent}% — about two months free
            </div>
          )}
          <div className="inline-flex rounded-lg border border-border bg-card/50 p-1" aria-label="Billing interval">
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

      <section className="mb-12" aria-labelledby="included-highlights-heading">
        <div className="mb-5 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            Included creative tools
          </p>
          <h2 id="included-highlights-heading" className="mt-2 text-2xl font-bold sm:text-3xl">
            More than just music videos
          </h2>
          <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            Your plan credits unlock the full AIBeatSync creative suite as your tier grows.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[
            {
              icon: Music2,
              title: "Music",
              description: "Unlimited access to royalty-free AI Soundtracks, limited only by the credits in your tier.",
            },
            {
              icon: ImageIcon,
              title: "AI Image Generation",
              description: `New: create consistent image packs for ${GENERATED_IMAGE_CREDITS_PER_VISUAL} credits per image.`,
            },
            {
              icon: Youtube,
              title: "Narrative Videos for YouTube",
              description: "Build chronological, story-led videos with scene-by-scene visuals for long-form YouTube content.",
            },
            {
              icon: Mic2,
              title: "Narration & Podcast Media",
              description: "Create mixed narration from a script, then turn long-form audio or video into captioned episodes and highlights.",
            },
          ].map(({ icon: FeatureIcon, title, description }) => (
            <div
              key={title}
              className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/[0.08] via-card/70 to-accent/[0.05] p-5"
            >
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-primary">
                <FeatureIcon className="h-5 w-5" />
              </div>
              <h3 className="font-semibold">{title}</h3>
              <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{description}</p>
            </div>
          ))}
        </div>
        <div className="mx-auto mt-5 flex max-w-3xl items-start gap-2 rounded-2xl border border-primary/30 bg-primary/10 px-4 py-3 text-center text-sm sm:items-center sm:justify-center sm:rounded-full">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary sm:mt-0" />
          <span>
            <strong className="text-foreground">New features are included as we grow.</strong>{" "}
            We keep expanding what your tier can create—no separate feature unlock required.
          </span>
        </div>
      </section>

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

      <section className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
        {subscriptions.map((plan) => {
          const price =
            plan.prices.find((p) => p.interval === interval) ??
            plan.prices.find((p) => p.interval === "month") ??
            plan.prices[0];
          if (!price) return null;
          const Icon = TIER_ICONS[plan.name.toLowerCase()] ?? Sparkles;
          const yearlySaving =
            price.interval === "year" ? getYearlySavings(plan.prices) : null;
          const monthlyEquivalent =
            price.interval === "year" ? price.unitAmount / 12 : null;
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
                  {yearlySaving && monthlyEquivalent !== null && (
                    <div className="mt-3 rounded-lg border border-primary/25 bg-primary/10 px-3 py-2 text-sm">
                      <span className="font-semibold text-primary">
                        Save {formatPrice(yearlySaving.amount, price.currency)}
                      </span>
                      <span className="text-muted-foreground"> a year · {yearlySaving.percent}% off monthly</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {formatPrice(monthlyEquivalent, price.currency)}/month when billed yearly
                      </span>
                    </div>
                  )}
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
                      <strong>Unlimited AI Soundtracks</strong>{" "}
                      <span className="text-muted-foreground">
                        — instrumental songs use 5–10 credits by length; songs with lyrics use 18 credits per generated minute
                      </span>
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                    <span>
                      <strong>AI Narration</strong>{" "}
                      <span className="text-muted-foreground">
                        — 3 credits per started 1,000 script characters, 3-credit minimum; a generated music bed adds 4 credits
                      </span>
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                    <span>
                      <strong>Use your own background music at no extra music-generation charge</strong>{" "}
                      <span className="text-muted-foreground">
                        — choose an AIBeatSync soundtrack, upload audio, import a Suno song, or use voice only
                      </span>
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                    <span>
                      <strong>Podcast Media</strong>{" "}
                      <span className="text-muted-foreground">
                        — captioned 16:9 episodes, three vertical highlights, titles, descriptions, and downloads
                      </span>
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                    <span>
                      <strong>New: AI Image Generation</strong>{" "}
                      <span className="text-muted-foreground">
                        — {GENERATED_IMAGE_CREDITS_PER_VISUAL} credits per generated image, limited only by your credit balance
                      </span>
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                    <span>
                      <strong>Unlimited</strong> Montage Studio exports — arrange clips, photos &amp; music with
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
                    : isAuthenticated
                      ? price.interval === "year"
                        ? "Start yearly & save"
                        : "Subscribe monthly"
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
                      onClick={() => handleSubscribe(
                        price.id,
                        plan.name.toLowerCase(),
                        price.interval ?? "one_time",
                        "topup",
                      )}
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
