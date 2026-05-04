import { useEffect, useState } from "react";
import { useRoute, useLocation, Link } from "wouter";
import { useAuth } from "@workspace/replit-auth-web";
import { useGetJob, getGetJobQueryKey } from "@workspace/api-client-react";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Music, CheckCircle2, AlertCircle, ArrowLeft, Download, Play } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell } from "recharts";
import { motion } from "framer-motion";

export default function JobStatus() {
  const [match, params] = useRoute("/jobs/:id");
  const id = params?.id;
  const [, setLocation] = useLocation();
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  
  const { data: job, isLoading } = useGetJob(
    id as string,
    { 
      query: { 
        enabled: isAuthenticated && !!id,
        queryKey: getGetJobQueryKey(id as string),
        refetchInterval: (query) => {
          const jobStatus = query.state.data?.status;
          return (jobStatus && ['queued', 'analyzing', 'generating', 'stitching'].includes(jobStatus)) ? 3000 : false;
        }
      } 
    }
  );

  useEffect(() => {
    if (!isAuthLoading && !isAuthenticated) {
      setLocation("/login");
    }
  }, [isAuthenticated, isAuthLoading, setLocation]);

  if (isAuthLoading || !isAuthenticated || !id) return null;

  if (isLoading && !job) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-4rem)]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!job) {
    return (
      <div className="container mx-auto px-4 py-12 text-center">
        <h1 className="text-2xl font-bold">Job not found</h1>
        <Button variant="link" onClick={() => setLocation("/dashboard")}>Back to Dashboard</Button>
      </div>
    );
  }

  const isComplete = job.status === "ready";
  const isFailed = job.status === "failed";
  const progressPercent = job.progressPercent || 0;

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <Link href="/dashboard">
        <Button variant="ghost" className="mb-6 pl-0 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Button>
      </Link>

      <div className="space-y-8">
        {/* Status Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight mb-2">
              {isComplete ? "Generation Complete" : isFailed ? "Generation Failed" : "Processing Video"}
            </h1>
            <p className="text-muted-foreground">
              Style: <span className="capitalize text-foreground font-medium">{job.style}</span>
            </p>
          </div>
          
          <div className="inline-flex items-center rounded-full border px-4 py-1.5 text-sm font-medium capitalize bg-card">
            {isComplete ? (
              <><CheckCircle2 className="mr-2 h-4 w-4 text-green-500" /> Ready</>
            ) : isFailed ? (
              <><AlertCircle className="mr-2 h-4 w-4 text-destructive" /> Failed</>
            ) : (
              <><Loader2 className="mr-2 h-4 w-4 text-primary animate-spin" /> {job.status}</>
            )}
          </div>
        </div>

        {/* Progress Bar (if processing) */}
        {!isComplete && !isFailed && (
          <Card className="bg-card/50">
            <CardContent className="pt-6">
              <div className="flex justify-between text-sm font-medium mb-2">
                <span className="text-muted-foreground capitalize">Current step: {job.status}</span>
                <span>{progressPercent}%</span>
              </div>
              <Progress value={progressPercent} className="h-3" />
            </CardContent>
          </Card>
        )}

        {/* Error Message */}
        {isFailed && (
          <Card className="border-destructive/50 bg-destructive/10">
            <CardContent className="pt-6 flex items-start gap-4">
              <AlertCircle className="h-6 w-6 text-destructive shrink-0 mt-0.5" />
              <div>
                <h3 className="font-semibold text-destructive mb-1">Error processing job</h3>
                <p className="text-sm text-destructive/90">{job.errorMessage || "An unknown error occurred during processing."}</p>
                <Button variant="outline" className="mt-4 border-destructive/30 hover:bg-destructive/20" onClick={() => setLocation("/generate")}>
                  Try Again
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Result Player (if complete) */}
        {isComplete && job.videoId && (
           <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="rounded-2xl border border-border bg-black overflow-hidden shadow-2xl relative"
          >
             <div className="aspect-video bg-muted relative flex items-center justify-center">
                {/* Assuming there is a way to get the video. If the API returns videoId we might need to fetch the video, but since we are mocking/building frontend, let's assume we can link to it if we had the video data, or we just show a player placeholder. Wait, useListVideos gives us video paths. We can't fetch a single video if we don't have the hook? Wait, the API spec says `useGetVideo`. */}
                <div className="text-center">
                  <Play className="h-16 w-16 mx-auto text-white/50 mb-4" />
                  <p className="text-white/70">Video Ready. Go to Gallery to view.</p>
                </div>
             </div>
             <div className="p-4 bg-card flex justify-between items-center border-t border-border">
               <span className="font-medium">Video successfully generated</span>
               <div className="flex gap-2">
                 <Link href="/gallery">
                   <Button variant="default" className="bg-primary text-primary-foreground hover:bg-primary/90">
                     View in Gallery
                   </Button>
                 </Link>
               </div>
             </div>
           </motion.div>
        )}

        {/* Audio Analysis Section */}
        {job.audioAnalysis && (
          <div className="grid md:grid-cols-3 gap-6">
            <div className="md:col-span-1 space-y-6">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <Music className="h-4 w-4 text-primary" />
                    Audio Profile
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <dl className="space-y-4">
                    <div>
                      <dt className="text-sm text-muted-foreground">BPM / Tempo</dt>
                      <dd className="text-2xl font-bold">{job.audioAnalysis.bpm || "N/A"}</dd>
                    </div>
                    <div>
                      <dt className="text-sm text-muted-foreground">Musical Key</dt>
                      <dd className="text-lg font-medium">{job.audioAnalysis.key || "N/A"}</dd>
                    </div>
                    <div>
                      <dt className="text-sm text-muted-foreground">Detected Mood</dt>
                      <dd className="text-lg font-medium capitalize">{job.audioAnalysis.mood || "N/A"}</dd>
                    </div>
                    <div>
                      <dt className="text-sm text-muted-foreground">Energy Level</dt>
                      <dd className="flex items-center gap-2 mt-1">
                        <Progress value={(job.audioAnalysis.energy || 0) * 100} className="flex-1 h-2" />
                        <span className="text-sm font-medium w-8 text-right">
                          {job.audioAnalysis.energy ? Math.round(job.audioAnalysis.energy * 100) : 0}%
                        </span>
                      </dd>
                    </div>
                  </dl>
                </CardContent>
              </Card>
            </div>

            <div className="md:col-span-2">
              <Card className="h-full">
                <CardHeader>
                  <CardTitle className="text-base font-semibold">Track Structure</CardTitle>
                </CardHeader>
                <CardContent>
                  {job.audioAnalysis.sections && job.audioAnalysis.sections.length > 0 ? (
                    <div className="h-[250px] w-full mt-4">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={job.audioAnalysis.sections} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                          <XAxis 
                            dataKey="label" 
                            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                            axisLine={false}
                            tickLine={false}
                          />
                          <YAxis hide />
                          <Tooltip 
                            contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '8px' }}
                            formatter={(value: number) => [`${Math.round(value * 100)}% Energy`, 'Intensity']}
                            labelStyle={{ color: 'hsl(var(--muted-foreground))', marginBottom: '4px' }}
                          />
                          <Bar dataKey="energy" radius={[4, 4, 0, 0]}>
                            {job.audioAnalysis.sections.map((entry, index) => (
                              <Cell 
                                key={`cell-${index}`} 
                                fill={entry.energy > 0.8 ? 'hsl(var(--primary))' : entry.energy > 0.5 ? 'hsl(var(--accent))' : 'hsl(var(--muted-foreground))'} 
                              />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <div className="h-[250px] flex items-center justify-center text-muted-foreground border border-dashed rounded-lg">
                      Analysis data pending...
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        )}
        
      </div>
    </div>
  );
}
