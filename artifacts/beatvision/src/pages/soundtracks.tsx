import { useState } from "react";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, Music2, Download, Video, Trash2, Share2, Link2, Lock, Wand2, Sparkles,
} from "lucide-react";

interface Soundtrack {
  id: string;
  title: string | null;
  prompt: string | null;
  objectPath: string;
  ext: string;
  durationSeconds: number | null;
  loopedToSeconds: number | null;
  provider: string | null;
  isPublic: boolean;
  shareToken: string | null;
  createdAt: string;
  url: string;
}

interface StatusResp {
  admin: boolean;
  enabled: boolean;
  isSignupBonus: boolean;
  freeAllowance: number;
  freeUsed: number;
  freeRemaining: number;
  creditsRemaining: number;
  subscriptionActive: boolean;
}

const LENGTH_OPTIONS = [
  { key: "loop5", label: "5s loop", seconds: 5 },
  { key: "loop10", label: "10s loop", seconds: 10 },
  { key: "short", label: "~30s", seconds: 30 },
  { key: "medium", label: "~1 min", seconds: 60 },
  { key: "long", label: "~1.5 min", seconds: 90 },
  { key: "full", label: "Max (2 min)", seconds: 120 },
];
const LOOP_OPTIONS = [
  { key: "off", label: "No loop", seconds: 0 },
  { key: "15", label: "15s", seconds: 15 },
  { key: "30", label: "30s", seconds: 30 },
  { key: "60", label: "1 min", seconds: 60 },
  { key: "90", label: "1.5 min", seconds: 90 },
  { key: "120", label: "2 min", seconds: 120 },
];
const PRESETS = [
  { label: "Lofi chill", prompt: "Lofi hip hop, mellow Rhodes piano, vinyl crackle, soft drums, 72 BPM" },
  { label: "Cinematic", prompt: "Cinematic orchestral score, building strings, epic percussion, emotional" },
  { label: "Trap", prompt: "Dark trap beat, heavy 808 bass, crisp hi-hats, moody, 140 BPM" },
  { label: "Synthwave", prompt: "Upbeat synthwave, retro arpeggios, driving bassline, neon, 110 BPM" },
  { label: "Acoustic", prompt: "Warm acoustic guitar, laid-back, coffee-shop, gentle percussion" },
  { label: "Ambient", prompt: "Ambient pads, ethereal, slow and dreamy soundscape, reverb" },
];

function songCredits(seconds: number): number {
  return Math.min(10, Math.max(5, Math.ceil((Math.min(Math.max(seconds, 5), 120) * 0.002 * 2) / 0.015)));
}
function fmtLen(s: Soundtrack): string {
  if (s.loopedToSeconds) return `${s.loopedToSeconds}s (looped)`;
  if (s.durationSeconds) return `${s.durationSeconds}s`;
  return "";
}

export default function Soundtracks() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  const [prompt, setPrompt] = useState("");
  const [lengthKey, setLengthKey] = useState("loop10");
  const [loopKey, setLoopKey] = useState("off");
  const duration = LENGTH_OPTIONS.find((l) => l.key === lengthKey)?.seconds ?? 10;
  const loopToSeconds = LOOP_OPTIONS.find((l) => l.key === loopKey)?.seconds ?? 0;

  const { data: status } = useQuery<StatusResp>({
    queryKey: ["soundtracks", "status"],
    queryFn: async () => {
      const res = await fetch("/api/music/soundtracks-status", { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: isAuthenticated,
  });

  const { data: tracks, isLoading, error } = useQuery({
    queryKey: ["soundtracks"],
    queryFn: async (): Promise<Soundtrack[]> => {
      const res = await fetch("/api/music/soundtracks", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load soundtracks");
      return (await res.json()).soundtracks;
    },
    enabled: isAuthenticated,
  });

  const gen = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/music/generate", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, durationSeconds: duration, ...(loopToSeconds > duration ? { loopToSeconds } : {}) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Generation failed");
      return data as { wasFree: boolean; creditsCharged: number; freeRemaining: number | null };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["soundtracks"] });
      queryClient.invalidateQueries({ queryKey: ["soundtracks", "status"] });
      toast({
        title: "Soundtrack ready",
        description: data.wasFree ? "Used one of your free Soundtracks." : `${data.creditsCharged} credits used.`,
      });
    },
    onError: (err: Error) => toast({ title: "Couldn't generate", description: err.message, variant: "destructive" }),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/music/soundtracks/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Delete failed");
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["soundtracks"] }); toast({ title: "Deleted" }); },
    onError: () => toast({ title: "Couldn't delete", variant: "destructive" }),
  });

  const togglePublic = useMutation({
    mutationFn: async ({ id, isPublic }: { id: string; isPublic: boolean }) => {
      const res = await fetch(`/api/music/soundtracks/${id}/public`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isPublic }),
      });
      if (!res.ok) throw new Error("Update failed");
      return res.json() as Promise<{ isPublic: boolean; shareToken: string; sharePath: string }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["soundtracks"] });
      if (data.isPublic) {
        const link = `${window.location.origin}${data.sharePath}`;
        navigator.clipboard?.writeText(link).catch(() => {});
        toast({ title: "Public — link copied", description: link });
      } else toast({ title: "Set to private" });
    },
    onError: () => toast({ title: "Couldn't update sharing", variant: "destructive" }),
  });

  const reuse = (s: Soundtrack) => {
    const t = encodeURIComponent(s.title || "AI Soundtrack");
    navigate(`/generate?audioObjectPath=${encodeURIComponent(s.objectPath)}&title=${t}`);
  };
  const copyLink = (s: Soundtrack) => {
    if (!s.shareToken) return;
    const link = `${window.location.origin}/s/${s.shareToken}`;
    navigator.clipboard?.writeText(link).catch(() => {});
    toast({ title: "Link copied", description: link });
  };

  if (authLoading) {
    return <div className="flex items-center justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }
  if (!isAuthenticated) {
    return (
      <div className="container mx-auto px-4 py-16 text-center">
        <Music2 className="h-10 w-10 mx-auto text-muted-foreground mb-4" />
        <h1 className="text-xl font-semibold mb-2">Soundtracks</h1>
        <p className="text-muted-foreground mb-6">Sign in to generate royalty-free instrumentals for your videos.</p>
        <Link href="/login"><Button className="bg-gradient-electric text-white border-0">Sign in</Button></Link>
      </div>
    );
  }

  const freeLabel = status
    ? status.admin
      ? "Unlimited (admin)"
      : status.isSignupBonus
        ? `${status.freeRemaining} of ${status.freeAllowance} free to try left`
        : `${status.freeRemaining} of ${status.freeAllowance} free this month`
    : null;

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl">
      <div className="flex items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Music2 className="h-6 w-6 text-primary" /> Soundtracks
            <Badge variant="outline" className="text-[10px] align-middle">Beta</Badge>
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Generate royalty-free instrumentals, then drop them into a video, download, or share.
          </p>
        </div>
        {freeLabel && (
          <div className="hidden sm:flex items-center gap-2 rounded-full border border-border/50 bg-secondary/40 px-3 py-1.5 text-sm shrink-0">
            <Sparkles className="h-4 w-4 text-primary" /> {freeLabel}
          </div>
        )}
      </div>

      {/* Generator */}
      <Card className="bg-card/50 border-card-border overflow-hidden mb-8">
        <div className="h-1 w-full bg-gradient-electric" />
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">New Soundtrack</CardTitle>
          <CardDescription>
            Describe the vibe. {status && !status.subscriptionActive && !status.admin
              ? "New users get 3 free to try — subscribe for a monthly batch."
              : "Free tracks come out of your monthly allowance; extras cost 5–10 credits."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {status && !status.enabled ? (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-300 px-3 py-2 text-sm">
              <b>Coming soon.</b> Soundtracks is in Beta and not open yet — check back shortly.
            </div>
          ) : (
            <>
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={3}
                placeholder="e.g. warm lofi hip hop, mellow Rhodes, vinyl crackle, 72 BPM"
                className="resize-none"
              />
              <div className="flex flex-wrap gap-1.5">
                {PRESETS.map((p) => (
                  <button key={p.label} type="button" onClick={() => setPrompt(p.prompt)}
                    className="text-xs px-2.5 py-1 rounded-full border border-border bg-background/40 text-muted-foreground hover:border-primary hover:text-primary transition-colors">
                    {p.label}
                  </button>
                ))}
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-sm font-medium">Length</label>
                  <span className="text-xs text-muted-foreground">≈ {songCredits(duration)} credits (free while you have free tracks)</span>
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  {LENGTH_OPTIONS.map((l) => (
                    <button key={l.key} type="button" onClick={() => setLengthKey(l.key)}
                      className={`rounded-lg border px-2 py-2 text-xs font-medium transition-colors ${lengthKey === l.key ? "border-primary bg-primary/10 text-primary" : "border-border bg-background/40 text-muted-foreground hover:border-primary/50"}`}>
                      {l.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-sm font-medium">Loop to fill (optional)</label>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mt-1.5">
                  {LOOP_OPTIONS.map((l) => (
                    <button key={l.key} type="button" onClick={() => setLoopKey(l.key)}
                      className={`rounded-lg border px-2 py-2 text-xs font-medium transition-colors ${loopKey === l.key ? "border-primary bg-primary/10 text-primary" : "border-border bg-background/40 text-muted-foreground hover:border-primary/50"}`}>
                      {l.label}
                    </button>
                  ))}
                </div>
              </div>

              <Button
                onClick={() => gen.mutate()}
                disabled={gen.isPending || prompt.trim().length < 3}
                className="bg-gradient-electric text-white border-0"
              >
                {gen.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Wand2 className="h-4 w-4 mr-2" />}
                Generate Soundtrack
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {/* Library */}
      <h2 className="text-lg font-semibold mb-3">Your library</h2>
      {isLoading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : error ? (
        <div className="py-12 text-center text-sm text-destructive">Failed to load your soundtracks.</div>
      ) : !tracks || tracks.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">No soundtracks yet — generate your first one above.</div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {tracks.map((s) => (
            <Card key={s.id} className="bg-card/50 border-card-border overflow-hidden">
              <div className="h-1 w-full bg-gradient-electric" />
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="font-semibold truncate">{s.title || "AI Soundtrack"}</h3>
                    {s.prompt && <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{s.prompt}</p>}
                  </div>
                  {s.isPublic && <Badge variant="outline" className="text-[10px] shrink-0">Public</Badge>}
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                  {fmtLen(s) && <span className="rounded-full border border-border px-2 py-0.5">{fmtLen(s)}</span>}
                  <span className="rounded-full border border-border px-2 py-0.5">{new Date(s.createdAt).toLocaleDateString()}</span>
                </div>
                <audio controls preload="none" src={s.url} className="w-full h-9" />
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Button size="sm" onClick={() => reuse(s)} className="bg-gradient-electric text-white border-0 h-8">
                    <Video className="h-3.5 w-3.5 mr-1.5" /> Use in video
                  </Button>
                  <a href={s.url} download={`${(s.title || "soundtrack").replace(/[^\w-]+/g, "_")}.${s.ext}`}>
                    <Button size="sm" variant="outline" className="h-8"><Download className="h-3.5 w-3.5 mr-1.5" /> Download</Button>
                  </a>
                  {s.isPublic ? (
                    <>
                      <Button size="sm" variant="outline" className="h-8" onClick={() => copyLink(s)}><Link2 className="h-3.5 w-3.5 mr-1.5" /> Copy link</Button>
                      <Button size="sm" variant="ghost" className="h-8" onClick={() => togglePublic.mutate({ id: s.id, isPublic: false })}><Lock className="h-3.5 w-3.5 mr-1.5" /> Make private</Button>
                    </>
                  ) : (
                    <Button size="sm" variant="outline" className="h-8" onClick={() => togglePublic.mutate({ id: s.id, isPublic: true })}><Share2 className="h-3.5 w-3.5 mr-1.5" /> Share</Button>
                  )}
                  <Button size="sm" variant="ghost" className="h-8 text-destructive hover:text-destructive ml-auto" onClick={() => del.mutate(s.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
