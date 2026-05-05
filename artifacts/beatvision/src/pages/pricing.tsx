import { useEffect, useMemo, useState } from "react";
import { useLocation, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { AUTH_QUERY_KEY, useAuth } from "@/hooks/useAuth";
import {
  useListBillingPlans,
  useGetBillingSubscription,
  useListBillingGrants,
  createBillingCheckout,
  createBillingPortalSession,
  getGetBillingSubscriptionQueryKey,
  getGetCreditsQueryKey,
  getGetDashboardStatsQueryKey,
  type BillingSubscriptionResponse,
  type CreditGrant,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Check,
  Loader2,
  Zap,
  Crown,
  Sparkles,
  CreditCard,
  ArrowLeft,
  ExternalLink,
  History,
} from "lucide-react";

type Interval = "month" | "year";

const SOURCE_LABELS: Record<CreditGrant["source"], string> = {
  subscription: "Subscription",
  topup: "Top-up",
  trial: "Trial",
  admin: "Admin grant",
};

const SOURCE_BADGE_VARIANT: Record<
  CreditGrant["source"],
  "default" | "secondary" | "outline"
> = {
  subscription: "default",
  topup: "secondary",
  trial: "outline",
  admin: "outline",
};

function formatGrantDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}


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

  const { data: plans, isLoading: plansLoading } = useListBillingPlans();
  const { data: subscription } = useGetBillingSubscription({
    query: { enabled: isAuthenticated },
  });
  const { data: grantsData, isError: grantsError } = useListBillingGrants({
    query: { enabled: isAuthenticated },
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
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">
          Choose your plan
        </h1>
        <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
          Each video uses 1 credit. Subscriptions auto-renew with fresh credits
          every cycle. Top-ups give you a one-time boost.
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

      <section className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
        {subscriptions.map((plan) => {
          const price =
            plan.prices.find((p) => p.interval === interval) ??
            plan.prices.find((p) => p.interval === "month") ??
            plan.prices[0];
          if (!price) return null;
          const Icon = TIER_ICONS[plan.name.toLowerCase()] ?? Sparkles;
          const isCurrent =
            subscription?.priceLookupKey &&
            price.lookupKey === subscription.priceLookupKey;

          return (
            <Card
              key={plan.id}
              className={`relative bg-card/50 border ${
                plan.popular
                  ? "border-primary/60 shadow-glow"
                  : "border-card-border"
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
                      {price.credits} video generations per{" "}
                      {price.interval === "year" ? "year" : "month"}
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                    <span>Beat-synced AI music videos</span>
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
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {topups.map((plan) => {
              const price = plan.prices[0];
              if (!price) return null;

              const faceValueCents = price.credits * 10; // $0.10/credit face value
              const savingsPct = faceValueCents > 0
                ? Math.round((1 - price.unitAmount / faceValueCents) * 100)
                : 0;
              const perCreditCents = price.unitAmount / price.credits;
              // Estimate videos: a typical 10s video costs 99 credits
              const estVideos = Math.floor(price.credits / 99);

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
                      ≈ {estVideos} videos · never expires
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

      {isAuthenticated && (
        <section className="mb-16" data-testid="section-credit-history">
          <div className="flex items-center gap-3 mb-6">
            <History className="h-5 w-5 text-primary" />
            <h2 className="text-2xl font-bold">Credit history</h2>
          </div>
          {grantsError ? (
            <Card className="bg-card/30 border-card-border">
              <CardContent className="py-10 text-center text-muted-foreground">
                Could not load credit history. Please try again later.
              </CardContent>
            </Card>
          ) : !grantsData ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : grantsData.grants.length === 0 ? (
            <Card className="bg-card/30 border-card-border">
              <CardContent className="py-10 text-center text-muted-foreground">
                No credit grants yet. Purchase a plan or top-up to get started.
              </CardContent>
            </Card>
          ) : (
            <Card className="bg-card/30 border-card-border overflow-hidden">
              <div className="divide-y divide-border/50">
                {grantsData.grants.map((grant) => {
                  const receiptUrl = grant.receiptUrl ?? null;
                  return (
                    <div
                      key={grant.id}
                      className="flex items-center justify-between gap-4 px-5 py-4"
                      data-testid={`grant-row-${grant.id}`}
                    >
                      <div className="flex items-center gap-4 min-w-0">
                        <Badge
                          variant={SOURCE_BADGE_VARIANT[grant.source]}
                          className="shrink-0"
                        >
                          {SOURCE_LABELS[grant.source]}
                        </Badge>
                        <span className="text-sm text-muted-foreground truncate">
                          {formatGrantDate(grant.createdAt)}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 shrink-0">
                        <span className="font-semibold tabular-nums">
                          +{grant.creditsGranted}{" "}
                          <span className="text-muted-foreground font-normal text-sm">
                            credit{grant.creditsGranted === 1 ? "" : "s"}
                          </span>
                        </span>
                        {receiptUrl ? (
                          <a
                            href={receiptUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-xs text-primary hover:underline"
                            data-testid={`receipt-link-${grant.id}`}
                          >
                            Receipt
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : (
                          <span className="text-xs text-muted-foreground w-14 text-right">
                            —
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
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
