import { StorageRetentionNotice } from "@/components/StorageRetentionNotice";
import { useEffect, useState } from "react";
import { useLocation, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useGetDashboardStats, getGetDashboardStatsQueryKey } from "@workspace/api-client-react";
import { LYRIC_OVERLAY_COST } from "@/lib/creditPricing";
import { FREE_OFFER_COPY } from "@/lib/freeOffer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Plus, Film, CheckCircle2, Clock, AlertCircle, Crown, Play, Coins, Trash2, Zap, Mail, X, Wand2, Music2, Sparkles, Smile, Quote, Lightbulb, Scissors, type LucideIcon } from "lucide-react";
import ReferEarnCard from "@/components/ReferEarnCard";
import { DashboardCreditBalance, DashboardCreditHistory } from "@/components/DashboardCredits";
import { Switch } from "@/components/ui/switch";
import { useQuery } from "@tanstack/react-query";
import { getDailyContent, type DailyItemType } from "@/lib/dailyContent";
import { useToast } from "@/hooks/use-toast";

const LOW_CREDIT_THRESHOLD = 60; // ≈ one 10s video left

const DAILY_ICONS: Record<DailyItemType, LucideIcon> = {
  pun: Smile,
  proverb: Quote,
  fact: Lightbulb,
  tip: Wand2,
};

function daysUntil(dateStr: string | null | undefined): number {
  if (!dateStr) return 0;
  return Math.max(0, Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86_400_000));
}

// Mirrors server-side calculateCreditCost — must stay in sync with creditCost.ts.
// Charge = real clip cost × tiered markup (2× single-clip / 1.5× multi-clip).
// Full videos use one unique paid scene per 10 seconds, capped at 10 min.
const RUNWAY_USD_PER_SECOND = 0.12; // Runway Gen-4.5: 12 API credits/s at $0.01/credit
const USD_PER_CREDIT = 0.015;
const MAX_FULL_SECONDS = 600;

function estimateCreditCost(requestedDuration: string | null | undefined, songDurationSec?: number | null): number {
  const dur = requestedDuration ?? "full";
  let numClips: number;
  let clipDurationSec: 5 | 10;
  const n = parseInt(dur ?? "", 10);
  if (dur === "full" || isNaN(n) || n <= 0) {
    const secs = songDurationSec && songDurationSec > 0 ? songDurationSec : MAX_FULL_SECONDS;
    numClips = Math.max(1, Math.min(60, Math.ceil(Math.min(secs, MAX_FULL_SECONDS) / 10)));
    clipDurationSec = 10;
  } else {
    clipDurationSec = n <= 5 ? 5 : 10;
    numClips = Math.max(1, Math.ceil(n / clipDurationSec));
  }
  const costCredits = (numClips * clipDurationSec * RUNWAY_USD_PER_SECOND) / USD_PER_CREDIT;
  return Math.ceil(costCredits * (numClips <= 1 ? 2 : 1.5));
}

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const { user, isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const [watchingJobId, setWatchingJobId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [welcomeDismissed, setWelcomeDismissed] = useState(() => {
    try { return localStorage.getItem("abs_welcome_dismissed") === "1"; } catch { return false; }
  });
  const dismissWelcome = () => {
    try { localStorage.setItem("abs_welcome_dismissed", "1"); } catch { /* ignore */ }
    setWelcomeDismissed(true);
  };
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Delete a video straight from the dashboard. Soft-deletes it (removed from
  // the dashboard, library and gallery); refresh stats so it disappears here.
  async function handleDelete(videoId: string) {
    if (!window.confirm("Delete this video? It will be removed from your dashboard and library.")) return;
    setDeletingId(videoId);
    try {
      const r = await fetch(`/api/videos/${videoId}`, { method: "DELETE", credentials: "include" });
      if (!r.ok) throw new Error("delete failed");
      await queryClient.invalidateQueries({ queryKey: getGetDashboardStatsQueryKey() });
    } catch {
      // silently ignore
    } finally {
      setDeletingId(null);
    }
  }

  // Cancel an in-progress job from the Processing list.
  async function handleCancel(jobId: string) {
    if (!window.confirm("Cancel this job? It will stop and won't produce a video.")) return;
    setCancelingId(jobId);
    try {
      const r = await fetch(`/api/jobs/${jobId}/cancel`, { method: "POST", credentials: "include" });
      if (!r.ok) {
        const body = await r.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error || "Could not cancel this job.");
      }
      await queryClient.invalidateQueries({ queryKey: getGetDashboardStatsQueryKey() });
      toast({ title: "Job stopped" });
    } catch (error) {
      toast({
        title: "Could not stop the job",
        description: error instanceof Error ? error.message : "Try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setCancelingId(null);
    }
  }

  async function handleCancelAllPreviews() {
    if (!window.confirm("Stop all queued and active browser preview jobs? Your completed master videos will be kept.")) return;
    setCancelingId("all-preview-backfills");
    try {
      const r = await fetch("/api/jobs/preview-backfills/cancel-all", {
        method: "POST",
        credentials: "include",
      });
      const body = await r.json().catch(() => ({})) as { error?: string; canceled?: number };
      if (!r.ok) throw new Error(body.error || "Could not stop preview jobs.");
      await queryClient.invalidateQueries({ queryKey: getGetDashboardStatsQueryKey() });
      toast({
        title: "Preview jobs stopped",
        description: body.canceled
          ? `${body.canceled} preview job${body.canceled === 1 ? "" : "s"} canceled. Your master videos were kept.`
          : "No running preview jobs remained.",
      });
    } catch (error) {
      toast({
        title: "Could not stop preview jobs",
        description: error instanceof Error ? error.message : "Try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setCancelingId(null);
    }
  }

  // Delete a failed generation (the job itself, which has no video).
  async function handleDeleteJob(jobId: string) {
    if (!window.confirm("Delete this failed generation? This can't be undone.")) return;
    setDeletingId(jobId);
    try {
      const r = await fetch(`/api/jobs/${jobId}`, { method: "DELETE", credentials: "include" });
      if (!r.ok) throw new Error("delete failed");
      await queryClient.invalidateQueries({ queryKey: getGetDashboardStatsQueryKey() });
    } catch {
      // silently ignore
    } finally {
      setDeletingId(null);
    }
  }

  async function handleWatch(jobId: string) {
    setWatchingJobId(jobId);
    try {
      const r = await fetch(`/api/jobs/${jobId}/video-url`);
      if (!r.ok) throw new Error("url");
      const { url } = await r.json() as { url: string };
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      // silently fail
    } finally {
      setWatchingJobId(null);
    }
  }

  const { data: stats, isLoading: statsLoading } = useGetDashboardStats({
    query: {
      queryKey: getGetDashboardStatsQueryKey(),
      enabled: isAuthenticated,
      // Auto-refresh while any video is still processing so status stays live.
      refetchInterval: 6000,
    }
  });

  const activeJobs = ((stats as unknown as { activeJobs?: Array<{
    id: string; prompt: string | null; status: string; progressPercent: number | null; jobType?: string | null;
  }> })?.activeJobs) ?? [];
  const activePreviewJobs = (stats as unknown as { activePreviewJobs?: number })?.activePreviewJobs ?? 0;

  // Render-finished email preference.
  const { data: prefs } = useQuery({
    queryKey: ["auth", "preferences"],
    queryFn: async () => {
      const r = await fetch("/api/auth/preferences", { credentials: "include" });
      if (!r.ok) throw new Error("prefs");
      return r.json() as Promise<{ notifyOnComplete: boolean }>;
    },
    enabled: isAuthenticated,
    staleTime: 5 * 60 * 1000,
  });
  const [notifyOverride, setNotifyOverride] = useState<boolean | null>(null);
  const notifyOn = notifyOverride ?? prefs?.notifyOnComplete ?? true;

  async function toggleNotify(value: boolean) {
    setNotifyOverride(value);
    try {
      await fetch("/api/auth/preferences", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notifyOnComplete: value }),
      });
    } catch {
      setNotifyOverride(!value); // revert on failure
    }
  }

  useEffect(() => {
    if (!isAuthLoading && !isAuthenticated) {
      setLocation("/login");
    }
  }, [isAuthenticated, isAuthLoading, setLocation]);

  if (isAuthLoading || !isAuthenticated) return null;

  const isAdmin = user?.isAdmin ?? false;
  const subStatus = user?.subscriptionStatus ?? "none";
  const trialDaysLeft = daysUntil(user?.trialEndsAt);
  const trialExpired = subStatus === "trial" && trialDaysLeft === 0;
  const daily = getDailyContent();
  const DailyIcon = DAILY_ICONS[daily.type];

  return (
    <div className="container mx-auto px-4 py-12 max-w-6xl">
      <StorageRetentionNotice />
      {subStatus === "trial" && !isAdmin && (
        <div className={`mb-6 flex flex-col items-stretch gap-3 rounded-lg border px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-4 ${
          trialExpired
            ? "border-destructive/40 bg-destructive/5 text-destructive"
            : "border-primary/30 bg-primary/5"
        }`}>
          <div className="flex items-start gap-2">
            <Clock className={`h-4 w-4 shrink-0 ${trialExpired ? "text-destructive" : "text-primary"}`} />
            <span>
              {trialExpired
                ? "Your Montage Studio trial has ended. Non-paid accounts can still make 10 clean Montage exports per calendar month, then 15 credits each. AI generation requires credits and plan eligibility."
                : <>Montage Studio access — <strong>{trialDaysLeft} day{trialDaysLeft !== 1 ? "s" : ""}</strong> remaining within trial limits. Generation uses credits.</>}
            </span>
          </div>
          <Link href="/pricing">
            <Button
              size="sm"
              variant="outline"
              className={`w-full sm:w-auto ${trialExpired ? "border-destructive/40 text-destructive hover:bg-destructive/10" : "border-primary/40 text-primary hover:bg-primary/10"}`}
              data-testid="button-dashboard-upgrade"
            >
              <Crown className="mr-1.5 h-3.5 w-3.5" />
              Upgrade
            </Button>
          </Link>
        </div>
      )}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div>
          <h1 className="text-4xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground mt-1">Overview of your generations and credits.</p>
        </div>
        
        <Link href="/editor">
          <Button className="bg-gradient-electric text-white shadow-glow">
            <Plus className="mr-2 h-4 w-4" />
            New Montage
          </Button>
        </Link>
      </div>

      {statsLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : stats ? (
        <div className="space-y-8">
          {!welcomeDismissed && stats.totalJobs === 0 && (
            <div className="relative overflow-hidden rounded-2xl border border-primary/30 bg-primary/[0.06] p-6">
              <button onClick={dismissWelcome} className="absolute right-3 top-3 text-muted-foreground hover:text-foreground" aria-label="Dismiss">
                <X className="h-4 w-4" />
              </button>
              <h2 className="flex items-center gap-2 text-xl font-bold">
                <Sparkles className="h-5 w-5 text-primary" /> Welcome to AIBeatSync
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                <strong className="text-foreground">{FREE_OFFER_COPY.short}</strong> {FREE_OFFER_COPY.example} {FREE_OFFER_COPY.expiry} Music uses credits except for paid subscribers&apos; included monthly instrumentals. AI images, video and narration use credits and are subject to plan rules. Montage Studio remains available within trial and post-trial limits even when credits are exhausted. Here's how to start:
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <Link href="/editor" className="rounded-xl border border-border bg-background/40 p-4 transition-colors hover:border-primary/50">
                  <Scissors className="mb-2 h-5 w-5 text-primary" />
                  <p className="text-sm font-semibold">Montage Studio</p>
                  <p className="text-xs text-muted-foreground">Clean exports of your uploaded clips & music within your trial or post-trial limits.</p>
                </Link>
                <Link href="/generate" className="rounded-xl border border-border bg-background/40 p-4 transition-colors hover:border-primary/50">
                  <Wand2 className="mb-2 h-5 w-5 text-primary" />
                  <p className="text-sm font-semibold">Generate AI Video</p>
                  <p className="text-xs text-muted-foreground">Turn any song into a beat-synced AI video (uses credits).</p>
                </Link>
                <Link href="/soundtracks" className="rounded-xl border border-border bg-background/40 p-4 transition-colors hover:border-primary/50">
                  <Music2 className="mb-2 h-5 w-5 text-primary" />
                  <p className="text-sm font-semibold">Create Music</p>
                  <p className="text-xs text-muted-foreground">Royalty-free instrumentals in seconds.</p>
                </Link>
              </div>
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <Card className="bg-card/50 border-card-border">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total Videos</CardTitle>
                <Film className="h-4 w-4 text-primary" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{stats.totalVideos}</div>
              </CardContent>
            </Card>
            
            <DashboardCreditBalance stats={stats} welcomeExpiresAt={stats.welcomeExpiresAt ?? null} />

            <Card className="bg-card/50 border-card-border">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Processing</CardTitle>
                <Clock className="h-4 w-4 text-yellow-500" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{stats.processingJobs}</div>
              </CardContent>
            </Card>

            <Card className="bg-card/50 border-card-border">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Completed Jobs</CardTitle>
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{stats.completedJobs}</div>
              </CardContent>
            </Card>
          </div>

          {stats.creditsRemaining < LOW_CREDIT_THRESHOLD && (
            <div
              className="flex flex-col items-stretch gap-3 rounded-lg border border-accent/40 bg-accent/5 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-4"
              data-testid="banner-low-credits"
            >
              <div className="flex items-start gap-2">
                <Zap className="h-4 w-4 text-accent shrink-0" />
                <span>
                  {stats.creditsRemaining === 0
                    ? "AI generation needs credits — top up or upgrade to generate more. Clean Montage Studio exports remain available within applicable limits."
                    : <>Running low — <strong>{stats.creditsRemaining}</strong> credit{stats.creditsRemaining === 1 ? "" : "s"} left (a 10s video costs 60).</>}
                </span>
              </div>
              <Link href="/pricing">
                <Button size="sm" variant="outline" className="w-full sm:w-auto border-accent/40 text-accent hover:bg-accent/10">
                  <Coins className="mr-1.5 h-3.5 w-3.5" />
                  Get credits
                </Button>
              </Link>
            </div>
          )}

          {user && <DashboardCreditHistory userId={user.id} />}

          {/* Something of the Day — rotates daily, deterministic by date */}
          <div className="flex items-start gap-4 p-5 rounded-2xl bg-card/60 border border-card-border">
            <div className="flex-shrink-0 h-10 w-10 rounded-xl bg-primary/15 flex items-center justify-center">
              <DailyIcon className="h-5 w-5 text-primary" />
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-primary mb-1">{daily.label}</div>
              <p className="text-sm md:text-base text-foreground/90 leading-relaxed">{daily.text}</p>
            </div>
          </div>

          <ReferEarnCard />

          <div className="flex items-center justify-between rounded-lg border border-border/50 bg-card/30 px-4 py-3">
            <div className="flex items-center gap-2 text-sm">
              <Mail className="h-4 w-4 text-primary shrink-0" />
              <span>Email me when renders finish or fail</span>
            </div>
            <Switch
              checked={notifyOn}
              onCheckedChange={toggleNotify}
              data-testid="switch-notify-on-complete"
            />
          </div>

          {activeJobs.length > 0 && (
            <div className="mb-8">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h2 className="flex items-center gap-2 text-2xl font-semibold">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" /> Processing
                </h2>
                {activePreviewJobs > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    disabled={cancelingId === "all-preview-backfills"}
                    onClick={handleCancelAllPreviews}
                  >
                    {cancelingId === "all-preview-backfills"
                      ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      : <X className="mr-2 h-4 w-4" />}
                    Stop All Preview Jobs ({activePreviewJobs})
                  </Button>
                )}
              </div>
              <div className="space-y-3">
                {activeJobs.map((j) => {
                  const pct = typeof j.progressPercent === "number" ? j.progressPercent : null;
                   const label =
                      j.jobType === "preview_backfill"
                        ? j.status === "queued" ? "Browser preview queued" : "Creating browser preview"
                     : j.status === "pending_approval" ? "Gen Preview · Review required"
                    : j.status === "queued" ? "Queued"
                    : j.status === "analyzing" ? "Analyzing audio"
                    : j.status === "generating" ? "Generating clips"
                    : j.status === "stitching" ? "Finishing up"
                    : j.status;
                  return (
                    <div key={j.id} className="rounded-xl border border-primary/20 bg-primary/[0.04] p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {j.prompt || (
                              j.jobType === "preview_backfill"
                                ? "Optimized browser preview"
                                : j.jobType === "editor_render" ? "Montage Studio export" : "AI video"
                            )}
                          </p>
                          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Loader2 className="h-3 w-3 animate-spin text-primary" /> {label}{pct !== null ? ` · ${pct}%` : ""}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <Button size="sm" variant="outline" onClick={() => setLocation(`/jobs/${j.id}`)}>
                            {j.status === "pending_approval" ? "Open Gen Preview" : "View status"}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-muted-foreground hover:text-destructive"
                            disabled={cancelingId === j.id}
                            onClick={() => handleCancel(j.id)}
                            title="Cancel this job"
                          >
                            {cancelingId === j.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                          </Button>
                        </div>
                      </div>
                      {pct !== null && (
                        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-secondary/60">
                          <div className="h-full rounded-full bg-gradient-electric transition-[width] duration-500" style={{ width: `${Math.max(4, pct)}%` }} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <h2 className="text-2xl font-semibold mb-6">Recent Activity</h2>
            
            {stats.recentJobs && stats.recentJobs.length > 0 ? (
              <div className="rounded-xl border border-border bg-card/30 overflow-hidden">
                <div className="hidden md:grid md:grid-cols-12 md:gap-4 md:border-b md:border-border/50 md:bg-muted/20 md:p-4 md:text-sm md:font-medium md:text-muted-foreground">
                  <div className="md:col-span-3">Prompt</div>
                  <div className="hidden md:block md:col-span-2">Style</div>
                  <div className="col-span-4 md:col-span-3">Status</div>
                  <div className="col-span-3 md:col-span-2 text-right">Cost</div>
                  <div className="hidden md:block md:col-span-2 text-right">Date</div>
                </div>
                
                <div className="divide-y divide-border/50">
                  {stats.recentJobs.map((job) => {
                    const j = job as {
                      jobType?: string | null;
                      requestedDuration?: string | null;
                      durationSeconds?: number | null;
                      lyricsText?: string | null;
                      manifest?: { chargeCredits?: boolean; chargeAmount?: number } | null;
                    };
                    // Montage Studio (editor_render) is pure ffmpeg — show the ACTUAL
                    // charge (0 when free on trial/subscription or within the monthly
                    // free allotment, else the flat overage), never the AI estimate.
                    const cost = j.jobType === "editor_render"
                      ? (j.manifest?.chargeCredits ? (j.manifest?.chargeAmount ?? 0) : 0)
                      : estimateCreditCost(j.requestedDuration, j.durationSeconds) +
                        (j.lyricsText?.trim() ? LYRIC_OVERLAY_COST : 0);
                    const videoId = (job as { videoId?: string | null }).videoId ?? null;
                    const isReady = job.status === 'ready';
                    const isFailed = job.status === 'failed';
                    const isProcessing = !isReady && !isFailed;
                    return (
                    <Link key={job.id} href={`/jobs/${job.id}`}>
                    <div className={`grid grid-cols-1 gap-3 p-4 transition-colors md:grid-cols-12 md:items-center md:gap-4 ${isProcessing || isFailed ? "cursor-pointer hover:bg-muted/10" : "hover:bg-muted/5"}`}>
                      <div className="min-w-0 text-sm font-medium md:col-span-3 md:truncate md:pr-2">
                        {job.prompt || "Untitled generation"}
                      </div>
                      <div className="hidden md:block md:col-span-2 capitalize text-sm text-muted-foreground truncate">
                        {job.style}
                      </div>
                      <div className="flex items-center gap-2 md:col-span-3">
                        {isReady ? (
                          <>
                            <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                            <Button
                              size="sm"
                              className="h-9 px-3 text-xs bg-gradient-electric text-white shadow-glow md:h-7"
                              disabled={watchingJobId === job.id}
                              onClick={(e) => { e.preventDefault(); handleWatch(job.id); }}
                            >
                              {watchingJobId === job.id
                                ? <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                : <Play className="h-3 w-3 mr-1" />}
                              Watch
                            </Button>
                            {videoId && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-9 w-9 p-0 text-muted-foreground hover:text-destructive md:h-7 md:w-7"
                                title="Delete video"
                                disabled={deletingId === videoId}
                                onClick={(e) => { e.preventDefault(); handleDelete(videoId); }}
                              >
                                {deletingId === videoId
                                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  : <Trash2 className="h-3.5 w-3.5" />}
                              </Button>
                            )}
                          </>
                        ) : isFailed ? (
                          <>
                            <span className="flex items-center gap-1.5 text-sm text-destructive">
                              <AlertCircle className="h-4 w-4 shrink-0" />
                              Failed
                            </span>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-9 w-9 p-0 text-muted-foreground hover:text-destructive md:h-7 md:w-7"
                              title="Delete failed generation"
                              disabled={deletingId === job.id}
                              onClick={(e) => { e.preventDefault(); handleDeleteJob(job.id); }}
                              data-testid={`delete-failed-${job.id}`}
                            >
                              {deletingId === job.id
                                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                : <Trash2 className="h-3.5 w-3.5" />}
                            </Button>
                          </>
                        ) : (
                          <span className="flex items-center gap-1.5 text-sm text-primary">
                            <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                            <span className="capitalize">{job.status}…</span>
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 text-sm font-medium text-accent md:col-span-2 md:justify-end">
                        <Coins className="h-3.5 w-3.5 shrink-0" />
                        <span>{cost}</span>
                      </div>
                      <div className="hidden md:block md:col-span-2 text-right text-sm text-muted-foreground">
                        {new Date(job.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                    </Link>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="text-center py-20 border border-dashed border-border rounded-xl bg-card/30">
                <Film className="h-12 w-12 text-muted-foreground mx-auto mb-4 opacity-20" />
                <h3 className="text-lg font-medium mb-2">No generations yet</h3>
                <p className="text-muted-foreground mb-6">Create your first AI music video to see it here.</p>
                <Link href="/generate">
                  <Button variant="outline">Start Generating</Button>
                </Link>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
