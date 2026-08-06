import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { TutorialTip } from "@/components/TutorialTip";
import {
  Loader2, Music2, Download, Video, Trash2, Share2, Link2, Lock, Wand2, Sparkles, Pencil, Check, X, Scissors,
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
function genPhase(p: number): string {
  if (p >= 99) return "Finishing up…";
  if (p >= 80) return "Mixing & mastering…";
  if (p >= 55) return "Laying down the groove…";
  if (p >= 25) return "Arranging the instruments…";
  return "Composing your track…";
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
  const [progress, setProgress] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [libSearch, setLibSearch] = useState("");
  const [libSort, setLibSort] = useState<"new" | "old" | "name">("new");
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

  const { data: tracks, isLoading, error, refetch, isRefetching } = useQuery({
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
      setProgress(100);
      queryClient.invalidateQueries({ queryKey: ["soundtracks"] });
      queryClient.invalidateQueries({ queryKey: ["soundtracks", "status"] });
      toast({
        title: "Soundtrack ready",
        description: data.wasFree ? "Used one of your free Soundtracks." : `${data.creditsCharged} credits used.`,
      });
      setTimeout(() => setProgress(0), 900);
    },
    onError: (err: Error) => {
      setProgress(0);
      toast({ title: "Couldn't generate", description: err.message, variant: "destructive" });
    },
  });

  // Simulated progress while generating (no server-side events): ease toward 95%
  // over ~28s, then jump to 100% on success. Feels responsive without lying.
  // Handoff from Prompt Studio: /soundtracks?prompt=<text> prefills the prompt.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("prompt");
    if (!p) return;
    setPrompt(p);
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

  useEffect(() => {
    if (!gen.isPending) return;
    setProgress(6);
    const start = Date.now();
    const id = window.setInterval(() => {
      const elapsed = Date.now() - start;
      setProgress(Math.min(95, 95 * (1 - Math.exp(-elapsed / 14000))));
    }, 300);
    return () => window.clearInterval(id);
  }, [gen.isPending]);

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

  const rename = useMutation({
    mutationFn: async ({ id, title }: { id: string; title: string }) => {
      const res = await fetch(`/api/music/soundtracks/${id}/rename`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }),
      });
      if (!res.ok) throw new Error("Rename failed");
      return res.json();
    },
    onSuccess: () => { setEditingId(null); queryClient.invalidateQueries({ queryKey: ["soundtracks"] }); },
    onError: () => toast({ title: "Couldn't rename", variant: "destructive" }),
  });

  const useInGenerate = (s: Soundtrack) => {
    const t = encodeURIComponent(s.title || "AI Soundtrack");
    navigate(`/generate?audioObjectPath=${encodeURIComponent(s.objectPath)}&title=${t}`);
  };
  const useInRemix = (s: Soundtrack) => {
    const t = encodeURIComponent(s.title || "AI Soundtrack");
    navigate(`/editor?audio=${encodeURIComponent(s.url)}&title=${t}`);
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

  const visibleTracks = (tracks ?? [])
    .filter((s) => {
      const q = libSearch.trim().toLowerCase();
      if (!q) return true;
      return (s.title || "").toLowerCase().includes(q) || (s.prompt || "").toLowerCase().includes(q);
    })
    .sort((a, b) => {
      if (libSort === "name") return (a.title || "").localeCompare(b.title || "");
      const at = new Date(a.createdAt).getTime();
      const bt = new Date(b.createdAt).getTime();
      return libSort === "old" ? at - bt : bt - at;
    });

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl">
      <div className="flex items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Music2 className="h-6 w-6 text-primary" /> Soundtracks
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

      <div className="mb-6">
        <TutorialTip id="soundtracks" title="How Soundtracks work">
          Describe a vibe (or tap a preset), pick a length, and generate a royalty-free instrumental. It saves to your
          library automatically — play it, download it, rename it, or drop it straight into a video.
        </TutorialTip>
      </div>

      {/* Generator */}
      <Card className="bg-card/50 border-card-border overflow-hidden mb-8">
        <div className="h-1 w-full bg-gradient-electric" />
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">New Soundtrack</CardTitle>
          <CardDescription>
            Describe the vibe. {status && !status.subscriptionActive && !status.admin
              ? "New users get 3 free to try — no credits used. Subscribe for a batch every month."
              : "Free Soundtracks use your monthly free allowance and don't touch your credit balance. Only tracks beyond the free allowance cost credits (5–10 each)."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {status && !status.enabled ? (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-300 px-3 py-2 text-sm">
              <b>Coming soon.</b> Soundtracks isn't open on your account yet — check back shortly.
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
                  <span className="text-xs text-muted-foreground">
                    {status?.admin || (status?.freeRemaining ?? 0) > 0
                      ? "Free — no credits used"
                      : `≈ ${songCredits(duration)} credits`}
                  </span>
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

              {gen.isPending || progress > 0 ? (
                <div className="space-y-2 rounded-lg border border-primary/20 bg-primary/[0.04] p-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 font-medium text-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" /> {genPhase(progress)}
                    </span>
                    <span className="tabular-nums text-muted-foreground">{Math.round(progress)}%</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-secondary/60">
                    <div
                      className="h-full rounded-full bg-gradient-electric transition-[width] duration-300 ease-out"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground">This usually takes 15–40 seconds — hang tight.</p>
                </div>
              ) : (
                <Button
                  onClick={() => gen.mutate()}
                  disabled={prompt.trim().length < 3}
                  className="bg-gradient-electric text-white border-0"
                >
                  <Wand2 className="h-4 w-4 mr-2" /> Generate Soundtrack
                </Button>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Library */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Your library</h2>
        {tracks && tracks.length > 0 && (
          <div className="flex items-center gap-2">
            <input
              value={libSearch}
              onChange={(e) => setLibSearch(e.target.value)}
              placeholder="Search…"
              className="h-8 w-40 rounded-md border border-input bg-background px-2.5 text-sm focus:border-primary focus:outline-none"
            />
            <select
              value={libSort}
              onChange={(e) => setLibSort(e.target.value as "new" | "old" | "name")}
              className="h-8 rounded-md border border-input bg-background px-2 text-sm focus:border-primary focus:outline-none"
            >
              <option value="new">Newest</option>
              <option value="old">Oldest</option>
              <option value="name">Name (A–Z)</option>
            </select>
          </div>
        )}
      </div>
      {isLoading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : error ? (
        <div className="rounded-xl border border-border bg-card/30 py-14 px-6 text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-secondary/60">
            <Music2 className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="font-medium">Your library will show up here</p>
          <p className="mt-1 text-sm text-muted-foreground">We couldn't reach it just now. Give it a moment and try again.</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => refetch()} disabled={isRefetching}>
            {isRefetching ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null}
            Try again
          </Button>
        </div>
      ) : !tracks || tracks.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/20 py-14 px-6 text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-primary/10">
            <Music2 className="h-5 w-5 text-primary" />
          </div>
          <p className="font-medium">No soundtracks yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Generate your first one above — it'll appear here automatically, ready to play, download, or drop into a video.
          </p>
        </div>
      ) : visibleTracks.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">No soundtracks match “{libSearch}”.</div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {visibleTracks.map((s) => (
            <Card key={s.id} className="bg-card/50 border-card-border overflow-hidden">
              <div className="h-1 w-full bg-gradient-electric" />
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    {editingId === s.id ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && editTitle.trim()) rename.mutate({ id: s.id, title: editTitle.trim() });
                            if (e.key === "Escape") setEditingId(null);
                          }}
                          autoFocus
                          maxLength={120}
                          className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-sm"
                        />
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 shrink-0" disabled={!editTitle.trim()} onClick={() => rename.mutate({ id: s.id, title: editTitle.trim() })}><Check className="h-3.5 w-3.5" /></Button>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 shrink-0" onClick={() => setEditingId(null)}><X className="h-3.5 w-3.5" /></Button>
                      </div>
                    ) : (
                      <h3 className="font-semibold flex items-center gap-1.5">
                        <span className="truncate">{s.title || "AI Soundtrack"}</span>
                        <button onClick={() => { setEditingId(s.id); setEditTitle(s.title || ""); }} className="text-muted-foreground hover:text-primary shrink-0" title="Rename">
                          <Pencil className="h-3 w-3" />
                        </button>
                      </h3>
                    )}
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
                  <Button size="sm" onClick={() => useInRemix(s)} className="bg-gradient-electric text-white border-0 h-8">
                    <Scissors className="h-3.5 w-3.5 mr-1.5" /> Remix
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => useInGenerate(s)} className="h-8">
                    <Video className="h-3.5 w-3.5 mr-1.5" /> Generate
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
