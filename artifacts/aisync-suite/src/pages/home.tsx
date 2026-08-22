import { useEffect, useState, useRef } from "react";
import { useLocation } from "wouter";
import { Mic, Video, Sparkles, AlertTriangle, Check, Loader2, Link2, Coins, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useSEO } from "@/hooks/useSEO";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiErrorMessage } from "@/lib/api-error";
import { 
  useGetSuiteStatus, 
  getGetSuiteStatusQueryKey,
  useAuthorizeSuiteLink, 
  useCreateSuiteCheckout, 
  useCreateSuitePortal 
} from "@workspace/api-client-react";

const SUITE_PLANS = [
  {
    id: "creator",
    name: "Creator",
    description: "For active solo creators.",
    monthlyPrice: 29,
    yearlyPrice: 290,
    beatCredits: 1000,
    yearlyBeatCredits: 12000,
    podCredits: 200,
    yearlyPodCredits: 2400,
    popular: false,
  },
  {
    id: "pro",
    name: "Pro",
    description: "For serious content schedules.",
    monthlyPrice: 75,
    yearlyPrice: 750,
    beatCredits: 2500,
    yearlyBeatCredits: 30000,
    podCredits: 800,
    yearlyPodCredits: 9600,
    popular: true,
  },
  {
    id: "studio",
    name: "Studio",
    description: "For agencies and power users.",
    monthlyPrice: 105,
    yearlyPrice: 1050,
    beatCredits: 5000,
    yearlyBeatCredits: 60000,
    podCredits: 800,
    yearlyPodCredits: 9600,
    popular: false,
  }
] as const;

type SuitePlanId = (typeof SUITE_PLANS)[number]["id"];

export default function Home() {
  const { toast } = useToast();
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const [, setLocation] = useLocation();

  const searchParams = new URLSearchParams(window.location.search);
  const state = searchParams.get("state");
  const codeChallenge = searchParams.get("code_challenge");
  const returnTo = searchParams.get("return_to");

  const incomingPlan = searchParams.get("plan");
  const incomingInterval = searchParams.get("interval");
  const wasLinked = searchParams.get("linked") === "true";
  const wasSuccess =
    searchParams.get("status") === "success" ||
    searchParams.get("success") === "true";
  const wasCancelled =
    searchParams.get("status") === "cancelled" ||
    searchParams.get("cancelled") === "true";

  const [interval, setInterval] = useState<"month" | "year">(incomingInterval === "year" ? "year" : "month");

  useSEO({
    title: "AISync Suite — AIBeatSync + AIPodSync",
    description: "Get dedicated monthly credits for both AIBeatSync and AIPodSync in one powerful subscription.",
    canonical: "/",
  });

  const { data: status, isLoading: isStatusLoading } = useGetSuiteStatus({
    query: { enabled: isAuthenticated, queryKey: getGetSuiteStatusQueryKey() }
  });

  const authorizeLink = useAuthorizeSuiteLink();
  const checkout = useCreateSuiteCheckout();
  const portal = useCreateSuitePortal();

  // Handle the auto-link flow on mount if we have the params
  const hasAttemptedLink = useRef(false);
  useEffect(() => {
    if (isAuthenticated && state && codeChallenge && returnTo && !hasAttemptedLink.current) {
      hasAttemptedLink.current = true;
      authorizeLink.mutate({ data: { state, codeChallenge, returnUrl: returnTo } }, {
        onSuccess: (data) => {
          if (data.redirectUrl) window.location.href = data.redirectUrl;
        },
        onError: (err) => {
          toast({
            title: "Linking failed",
            description: apiErrorMessage(err, "Failed to authorize the account link."),
            variant: "destructive",
          });
        }
      });
    }
  }, [isAuthenticated, state, codeChallenge, returnTo, authorizeLink, toast]);

  if (isAuthLoading || (isAuthenticated && isStatusLoading)) {
    return (
      <div className="container mx-auto px-4 py-32 flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // If in link flow but not authenticated
  if (!isAuthenticated && state && codeChallenge && returnTo) {
    return (
      <div className="container mx-auto px-4 py-32 max-w-xl text-center min-h-[70vh] flex flex-col items-center justify-center animate-in fade-in zoom-in duration-500">
         <Badge className="mb-6 border-primary/30 bg-primary/10 text-primary px-3 py-1">
            <Link2 className="mr-2 h-4 w-4" />
            Account Link Request
          </Badge>
          <h1 className="text-3xl font-bold mb-4">Log in to link your accounts</h1>
          <p className="text-muted-foreground mb-8 text-lg">
            AIPodSync wants to link to your AIBeatSync account to share a Suite subscription.
          </p>
          <Button
            onClick={() =>
              setLocation(
                `/login?returnTo=${encodeURIComponent(`/${window.location.search}`)}`,
              )
            }
            size="lg"
            variant="electric"
            className="w-full sm:w-auto min-w-[200px]"
          >
            Log in to continue
          </Button>
      </div>
    );
  }

  // If actively linking
  if (state && codeChallenge && returnTo) {
    return (
      <div className="container mx-auto px-4 py-32 max-w-xl text-center min-h-[70vh] flex flex-col items-center justify-center">
         <Loader2 className="h-10 w-10 animate-spin mx-auto text-primary mb-6" />
         <h1 className="text-2xl font-bold mb-2">Linking Accounts...</h1>
         <p className="text-muted-foreground">Please wait while we connect your AIPodSync and AIBeatSync accounts.</p>
      </div>
    );
  }

  const activeSuite =
    status?.subscription?.status === "active" ? status.subscription : undefined;

  const handleCheckout = (planId: SuitePlanId) => {
    if (!isAuthenticated) {
      setLocation(`/login?returnTo=${encodeURIComponent("/?plan=" + planId + "&interval=" + interval)}`);
      return;
    }

    if (activeSuite) {
      portal.mutate({ data: { origin: "aisyncsuite" } }, {
        onSuccess: (data) => { if (data.url) window.location.href = data.url; },
        onError: (err) =>
          toast({
            title: "Portal error",
            description: apiErrorMessage(err, "Failed to open billing management."),
            variant: "destructive",
          }),
      });
      return;
    }

    if (!status?.linked) {
      window.location.href = "https://aipodsync.com/suite";
      return;
    }

    checkout.mutate({ data: { plan: planId, interval, origin: "aisyncsuite" } }, {
      onSuccess: (data) => {
        if (data.url) window.location.href = data.url;
      },
      onError: (err) => {
        toast({
          title: "Checkout failed",
          description: apiErrorMessage(err, "Failed to start checkout."),
          variant: "destructive",
        });
      }
    });
  };

  return (
    <div className="container mx-auto px-4 py-16 max-w-6xl min-h-[100dvh]">
      {wasSuccess && (
        <div className="max-w-3xl mx-auto mb-10 rounded-xl border border-accent bg-accent/10 p-4 text-accent flex items-center gap-3 animate-in slide-in-from-top-4">
          <Check className="h-5 w-5 shrink-0" />
          <span className="text-sm font-medium">Your Suite subscription is active! Welcome to the next level.</span>
        </div>
      )}

      {wasLinked && !wasSuccess && (
        <div className="max-w-3xl mx-auto mb-10 rounded-xl border border-primary/30 bg-primary/10 p-4 text-primary flex items-center gap-3 animate-in slide-in-from-top-4">
          <Link2 className="h-5 w-5 shrink-0" />
          <span className="text-sm font-medium">Accounts linked successfully! Choose a plan below to subscribe.</span>
        </div>
      )}

      {wasCancelled && (
        <div className="max-w-3xl mx-auto mb-10 rounded-xl border border-muted p-4 text-muted-foreground flex items-center gap-3 animate-in slide-in-from-top-4">
          <span className="text-sm font-medium">Checkout was cancelled. You can try again when you're ready.</span>
        </div>
      )}

      <div className="text-center max-w-3xl mx-auto mb-16 mt-4 animate-in fade-in zoom-in duration-700 delay-150 fill-mode-both">
        <Badge className="mb-6 border-primary/30 bg-primary/10 text-primary py-1.5 px-4 text-sm rounded-full">
          <Sparkles className="mr-2 h-4 w-4" aria-hidden="true" />
          The AISync Suite
        </Badge>
        <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight mb-6 leading-tight">
          Two studios. <br className="sm:hidden" />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary via-[#7c6bf5] to-accent">
            One subscription.
          </span>
        </h1>
        <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
          Get dedicated monthly credits for both AIBeatSync and AIPodSync without managing two separate bills.
          Your video credits never compete with your podcast credits.
        </p>
      </div>

      {activeSuite && (
        <Card className="max-w-3xl mx-auto mb-16 p-6 sm:p-8 border-primary/30 bg-primary/5 flex flex-col sm:flex-row items-center justify-between gap-6 shadow-glow animate-in fade-in slide-in-from-bottom-8">
          <div className="text-center sm:text-left">
            <h3 className="font-bold text-xl mb-2 flex items-center justify-center sm:justify-start gap-2">
              <Check className="h-5 w-5 text-primary" />
              Active Suite Subscription
            </h3>
            <p className="text-sm text-muted-foreground">
              You are currently on the <strong className="text-foreground font-semibold">{activeSuite.plan?.toUpperCase()}</strong> {activeSuite.interval} plan.
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-xs sm:justify-start">
              <span className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1.5 text-primary">
                {(status?.aibeatCredits ?? 0).toLocaleString()} AIBeatSync credits
              </span>
              <span className="rounded-full border border-accent/20 bg-accent/10 px-3 py-1.5 text-accent">
                {(status?.aipodCredits ?? 0).toLocaleString()} AIPodSync credits
              </span>
            </div>
          </div>
          <Button
            size="lg"
            className="w-full sm:w-auto bg-foreground text-background hover:bg-foreground/90 border-0"
            onClick={() => portal.mutate({ data: { origin: "aisyncsuite" } })}
            disabled={portal.isPending}
          >
            {portal.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Manage Subscription
          </Button>
        </Card>
      )}

      {(status?.hasDirectSubscription || status?.aipodHasDirectSubscription) && !activeSuite && (
        <div className="max-w-3xl mx-auto mb-12 rounded-xl border border-destructive/30 bg-destructive/10 p-5 text-destructive flex flex-col sm:flex-row items-start gap-4">
          <AlertTriangle className="h-6 w-6 shrink-0 mt-0.5" />
          <div className="text-sm leading-relaxed">
            <strong className="font-semibold block mb-1 text-base">Standalone subscription detected</strong>
            Manage or cancel the active standalone subscription before starting an AISync Suite plan.
            This prevents overlapping subscriptions and duplicate charges.
          </div>
        </div>
      )}

      {!activeSuite && (
        <div className="flex justify-center items-center gap-3 mb-12 animate-in fade-in slide-in-from-bottom-8 duration-500 delay-300 fill-mode-both">
          <span className={`text-sm font-medium transition-colors ${interval === "month" ? "text-foreground" : "text-muted-foreground"}`}>Monthly</span>
          <button
            type="button"
            onClick={() => setInterval(i => i === "month" ? "year" : "month")}
            className="relative inline-flex h-6 w-12 items-center rounded-full bg-primary/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-primary transition-transform duration-300 ${interval === "year" ? "translate-x-7" : "translate-x-1"}`} />
          </button>
          <span className={`text-sm font-medium transition-colors ${interval === "year" ? "text-foreground" : "text-muted-foreground"} flex items-center gap-2`}>
            Yearly
            <Badge variant="secondary" className="text-[10px] bg-accent/15 text-accent border-0 px-2 py-0.5 font-semibold">2 months free</Badge>
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-24 max-w-6xl mx-auto">
        {SUITE_PLANS.map((plan, i) => (
          <Card
            key={plan.id}
            className={`relative flex flex-col overflow-hidden transition-all duration-300 animate-in fade-in slide-in-from-bottom-8 fill-mode-both ${
              plan.popular
                ? "border-primary/50 shadow-glow scale-100 md:scale-105 z-10 bg-card/80 backdrop-blur-sm"
                : "border-border/50 bg-card/50 backdrop-blur-sm hover:border-primary/30"
            }`}
            style={{ animationDelay: `${400 + i * 150}ms` }}
          >
            {plan.popular && (
              <div className="absolute top-0 inset-x-0 h-1 bg-gradient-electric" />
            )}

            <div className="p-6 sm:p-8 flex-1">
              {plan.popular && (
                <Badge className="absolute top-4 right-4 bg-primary/10 text-primary border-primary/20">
                  Most Popular
                </Badge>
              )}

              <h3 className="text-2xl font-bold mb-2">{plan.name}</h3>
              <p className="text-sm text-muted-foreground mb-6 h-10">{plan.description}</p>

              <div className="mb-8">
                <span className="text-5xl font-extrabold tracking-tight">
                  ${interval === "month" ? plan.monthlyPrice : plan.yearlyPrice}
                </span>
                <span className="text-muted-foreground font-medium ml-1">/{interval === "month" ? "mo" : "yr"}</span>
              </div>

              <div className="space-y-4 mb-4">
                <div className="flex items-center gap-4 text-sm p-4 rounded-xl border border-primary/10 bg-primary/5 transition-colors hover:border-primary/20">
                  <div className="h-10 w-10 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
                    <Video className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <div className="font-bold text-foreground text-base tracking-tight">
                      {(interval === "year" ? plan.yearlyBeatCredits : plan.beatCredits).toLocaleString()}{" "}
                      <span className="font-normal text-muted-foreground text-sm">
                        credits/{interval === "year" ? "yr" : "mo"}
                      </span>
                    </div>
                    <div className="text-primary font-medium text-xs tracking-wide uppercase mt-0.5">in AIBeatSync</div>
                  </div>
                </div>

                <div className="flex items-center gap-4 text-sm p-4 rounded-xl border border-accent/10 bg-accent/5 transition-colors hover:border-accent/20">
                  <div className="h-10 w-10 rounded-lg bg-accent/15 flex items-center justify-center shrink-0">
                    <Mic className="h-5 w-5 text-accent" />
                  </div>
                  <div>
                    <div className="font-bold text-foreground text-base tracking-tight">
                      {(interval === "year" ? plan.yearlyPodCredits : plan.podCredits).toLocaleString()}{" "}
                      <span className="font-normal text-muted-foreground text-sm">
                        credits/{interval === "year" ? "yr" : "mo"}
                      </span>
                    </div>
                    <div className="text-accent font-medium text-xs tracking-wide uppercase mt-0.5">in AIPodSync</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="p-6 sm:p-8 pt-0 mt-auto">
              <Button
                onClick={() => handleCheckout(plan.id)}
                disabled={
                  (checkout.isPending && checkout.variables?.data.plan === plan.id) ||
                  Boolean(status?.hasDirectSubscription || status?.aipodHasDirectSubscription)
                }
                className={`w-full border-0 font-semibold text-base h-12 transition-all ${
                  plan.popular
                    ? "bg-gradient-electric text-white shadow-glow hover:opacity-90 hover:scale-[1.02]"
                    : "bg-secondary text-secondary-foreground hover:bg-secondary/80 hover:scale-[1.02]"
                }`}
                size="lg"
              >
                {checkout.isPending && checkout.variables?.data.plan === plan.id ? (
                  <Loader2 className="h-5 w-5 animate-spin mr-2" />
                ) : null}
                {activeSuite
                  ? "Switch Plan"
                  : status?.hasDirectSubscription || status?.aipodHasDirectSubscription
                    ? "Manage standalone plan first"
                    : status?.linked
                      ? "Choose " + plan.name
                      : "Link AIPodSync to continue"}
              </Button>
            </div>
          </Card>
        ))}
      </div>

      <div className="text-center max-w-xl mx-auto mb-10">
        <h2 className="text-3xl font-bold mb-4">How it works</h2>
        <p className="text-base text-muted-foreground">
          AIBeatSync and AIPodSync are built and run the same way — simple credit-based pricing, no bait-and-switch
          trials, and a habit of shipping the features you actually asked for.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto mb-20">
        {[
          {
            icon: Zap,
            title: "Instant provisioning",
            body: "Subscribe once and both balances fill up immediately. Log into either app and your credits are waiting.",
          },
          {
            icon: Coins,
            title: "Clear, separated credits",
            body: "Podcast rendering takes different resources than 4K video rendering. Two balances means you never have to guess conversion rates.",
          },
          {
            icon: Link2,
            title: "One unified bill",
            body: "A single charge from AISync Suite on your card. Upgrade, downgrade, or cancel everything from one central dashboard.",
          },
        ].map((v, i) => (
          <Card key={v.title} className="p-6 border-border/50 bg-card/30 hover:bg-card/50 transition-colors animate-in fade-in slide-in-from-bottom-8 fill-mode-both" style={{ animationDelay: `${800 + i * 100}ms`}}>
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 mb-5 text-primary shadow-glow">
              <v.icon className="h-6 w-6" aria-hidden="true" />
            </span>
            <h3 className="font-semibold text-lg mb-2">{v.title}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">{v.body}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
