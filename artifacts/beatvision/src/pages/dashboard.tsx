import { useEffect, useState } from "react";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { useGetDashboardStats } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Plus, Film, CheckCircle2, Clock, AlertCircle, Crown, Play } from "lucide-react";

function daysUntil(dateStr: string | null | undefined): number {
  if (!dateStr) return 0;
  return Math.max(0, Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86_400_000));
}

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const { user, isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const [watchingJobId, setWatchingJobId] = useState<string | null>(null);

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
      enabled: isAuthenticated,
    }
  });

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

  return (
    <div className="container mx-auto px-4 py-12 max-w-6xl">
      {subStatus === "trial" && !isAdmin && (
        <div className={`mb-6 flex items-center justify-between gap-4 rounded-lg border px-4 py-3 text-sm ${
          trialExpired
            ? "border-destructive/40 bg-destructive/5 text-destructive"
            : "border-primary/30 bg-primary/5"
        }`}>
          <div className="flex items-center gap-2">
            <Clock className={`h-4 w-4 shrink-0 ${trialExpired ? "text-destructive" : "text-primary"}`} />
            <span>
              {trialExpired
                ? "Your free trial has expired. Upgrade to keep creating videos."
                : <>Free trial — <strong>{trialDaysLeft} day{trialDaysLeft !== 1 ? "s" : ""}</strong> remaining.</>}
            </span>
          </div>
          <Link href="/pricing">
            <Button
              size="sm"
              variant="outline"
              className={`shrink-0 ${trialExpired ? "border-destructive/40 text-destructive hover:bg-destructive/10" : "border-primary/40 text-primary hover:bg-primary/10"}`}
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
        
        <Link href="/generate">
          <Button className="bg-gradient-electric text-white shadow-glow">
            <Plus className="mr-2 h-4 w-4" />
            New Generation
          </Button>
        </Link>
      </div>

      {statsLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : stats ? (
        <div className="space-y-8">
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
            
            <Card className="bg-card/50 border-card-border" data-testid="card-credits-remaining">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Credits Remaining</CardTitle>
                <div className="h-4 w-4 rounded-full bg-accent/20 flex items-center justify-center">
                  <div className="h-2 w-2 rounded-full bg-accent" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{stats.creditsRemaining}</div>
                {(stats.subscriptionCredits > 0 || stats.topupCredits > 0) && (
                  <div className="mt-1 text-xs text-muted-foreground" data-testid="text-credits-breakdown">
                    <span className="font-medium text-foreground/80">{stats.subscriptionCredits}</span> plan
                    <span className="mx-1">+</span>
                    <span className="font-medium text-foreground/80">{stats.topupCredits}</span> top-up
                  </div>
                )}
              </CardContent>
            </Card>

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

          <div>
            <h2 className="text-2xl font-semibold mb-6">Recent Activity</h2>
            
            {stats.recentJobs && stats.recentJobs.length > 0 ? (
              <div className="rounded-xl border border-border bg-card/30 overflow-hidden">
                <div className="grid grid-cols-12 gap-4 p-4 border-b border-border/50 bg-muted/20 text-sm font-medium text-muted-foreground">
                  <div className="col-span-6 md:col-span-5">Prompt</div>
                  <div className="col-span-3 md:col-span-2">Style</div>
                  <div className="col-span-3 md:col-span-3">Status</div>
                  <div className="hidden md:block col-span-2 text-right">Date</div>
                </div>
                
                <div className="divide-y divide-border/50">
                  {stats.recentJobs.map((job) => (
                    <div key={job.id} className="grid grid-cols-12 gap-4 p-4 hover:bg-muted/10 transition-colors items-center">
                      <div className="col-span-5 md:col-span-4 truncate pr-4 font-medium">
                        {job.prompt || "Untitled generation"}
                      </div>
                      <div className="col-span-3 md:col-span-2 capitalize text-sm text-muted-foreground">
                        {job.style}
                      </div>
                      <div className="col-span-4 md:col-span-4 flex items-center gap-2">
                        {job.status === 'ready' ? (
                          <>
                            <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                            <Button
                              size="sm"
                              className="h-7 text-xs bg-gradient-electric text-white shadow-glow px-3"
                              disabled={watchingJobId === job.id}
                              onClick={() => handleWatch(job.id)}
                            >
                              {watchingJobId === job.id
                                ? <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                : <Play className="h-3 w-3 mr-1" />}
                              Watch
                            </Button>
                          </>
                        ) : job.status === 'failed' ? (
                          <>
                            <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
                            <Link href={`/jobs/${job.id}`}>
                              <span className="text-sm text-destructive">Failed</span>
                            </Link>
                          </>
                        ) : (
                          <>
                            <Loader2 className="h-4 w-4 text-primary animate-spin shrink-0" />
                            <Link href={`/jobs/${job.id}`}>
                              <span className="text-sm capitalize text-primary">{job.status}…</span>
                            </Link>
                          </>
                        )}
                      </div>
                      <div className="hidden md:block col-span-2 text-right text-sm text-muted-foreground">
                        {new Date(job.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                  ))}
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
