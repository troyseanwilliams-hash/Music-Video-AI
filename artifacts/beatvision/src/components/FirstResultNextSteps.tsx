import { Link } from "wouter";
import { useGetDashboardStats, getGetDashboardStatsQueryKey } from "@workspace/api-client-react";
import { CheckCircle2, Coins, Film, ImageIcon, Wand2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { trackEvent } from "@/lib/analytics";
import { GENERATED_IMAGE_CREDITS_PER_VISUAL } from "@/lib/creditPricing";
import { affordableNextSteps, formatExpiry, getStarterCost, isAiEligible } from "@/lib/starterVideo";

const NEXT = {
  starter_video: { href: "/generate?guide=starter", icon: Wand2, label: "Another 5s video", cost: () => `${getStarterCost().total} credits` },
  images: { href: "/images", icon: ImageIcon, label: "Scene images", cost: () => `${GENERATED_IMAGE_CREDITS_PER_VISUAL} credits each` },
  montage: { href: "/editor", icon: Film, label: "Creator Studio", cost: () => "Within your export limits" },
} as const;

/** Shown under a finished video: how to keep it, plus optional next creations that fit the balance. Nothing starts automatically. */
export function FirstResultNextSteps() {
  const { user } = useAuth();
  // Always refetch: the balance just changed when this video was charged.
  const { data: stats, isLoading } = useGetDashboardStats({
    query: { queryKey: getGetDashboardStatsQueryKey(), staleTime: 0, refetchOnMount: "always" },
  });
  const balance = isLoading ? null : stats?.creditsRemaining ?? null;
  const steps = affordableNextSteps(balance, isAiEligible(user));
  const expiry = formatExpiry(stats?.welcomeExpiresAt ?? null);

  return (
    <section className="mx-auto w-full max-w-3xl rounded-2xl border border-primary/25 bg-primary/[0.04] p-5 sm:p-6" data-testid="card-first-result">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div>
          <h2 className="font-semibold">Your video is ready</h2>
          <p className="text-sm text-muted-foreground">Play it above, then use Download to save the MP4 or post it anywhere. Social cuts and Spotify Canvas exports are below.</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="flex items-center gap-1" data-testid="text-result-balance">
          <Coins className="h-4 w-4 text-accent" />
          {isLoading ? "Loading balance…" : <><strong>{balance ?? 0}</strong>&nbsp;credits left</>}
        </span>
        {expiry && <span className="text-xs text-muted-foreground">{expiry}</span>}
      </div>
      <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Optional next step</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        {steps.map((key) => {
          const n = NEXT[key];
          return (
            <Link
              key={key}
              href={n.href}
              onClick={() => trackEvent("first_result_next_step", { next: key })}
              className="flex min-h-11 items-center gap-3 rounded-xl border border-border/60 bg-background/60 p-3 transition-colors hover:border-primary/50"
              data-testid={`link-next-${key}`}
            >
              <n.icon className="h-4 w-4 shrink-0 text-primary" />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{n.label}</span>
                <span className="block text-xs text-muted-foreground">{n.cost()}</span>
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
