import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { TutorialTip } from "@/components/TutorialTip";
import { LYRICS_BUILD_COST, canAffordCredits } from "@/lib/creditPricing";
import TopUpRequiredDialog from "@/components/TopUpRequiredDialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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
  isCreatorAnonymous: boolean;
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
  vocalCost?: number;
  vocalCreditsPerMinute?: number;
  vocalsEnabled?: boolean;
}

const LENGTH_OPTIONS = [
  { key: "loop5", label: "5s loop", seconds: 5 },
  { key: "loop10", label: "10s loop", seconds: 10 },
  { key: "short", label: "~30s", seconds: 30 },
  { key: "medium", label: "~1 min", seconds: 60 },
  { key: "long", label: "~1.5 min", seconds: 90 },
  { key: "full", label: "Max (2 min)", seconds: 120 },
];
// Vocal styles fold into the song prompt (the music model reads voice from the prompt).
const VOCAL_STYLES = [
  { key: "auto", label: "Auto", desc: "" },
  { key: "female", label: "Female", desc: "female lead vocal" },
  { key: "male", label: "Male", desc: "male lead vocal" },
  { key: "duet", label: "Duet", desc: "male and female duet vocals" },
  { key: "group", label: "Group", desc: "group / choir vocals" },
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
  { label: "Ambient", prompt: "Ambient pads, ethereal, slow and dreamy soundscape, reverb" },
  { label: "Pop anthem", prompt: "Upbeat pop anthem, driving four-on-the-floor beat, bright synths, big sing-along chorus energy, 118 BPM" },
  { label: "R&B / Soul", prompt: "Smooth R&B, warm electric piano chords, laid-back groove, soulful and intimate, 90 BPM" },
  { label: "EDM", prompt: "High-energy EDM, pulsing sidechained bass, euphoric build and drop, festival-ready, 128 BPM" },
  { label: "Boom bap hip-hop", prompt: "Classic boom bap hip hop, dusty sampled drums, jazzy bassline, confident and gritty, 90 BPM" },
  { label: "Anthemic rock", prompt: "Anthemic alternative rock, driving electric guitars, powerful drums, big chorus energy, 130 BPM" },
  { label: "Reggaeton", prompt: "Reggaeton, dembow rhythm, warm bass, tropical percussion, festive and danceable, 95 BPM" },
  { label: "Afrobeats", prompt: "Afrobeats, warm layered percussion, groovy bassline, sunny and rhythmic, 105 BPM" },
  { label: "Gospel / choir", prompt: "Uplifting gospel, rich choir harmonies, organ and piano, powerful and inspirational, 100 BPM" },
  { label: "Deep house", prompt: "Deep house, warm rolling bassline, soulful chords, hypnotic groove, 122 BPM" },
];

function songCredits(seconds: number): number {
  return Math.min(10, Math.max(5, Math.ceil((Math.min(Math.max(seconds, 5), 120) * 0.002 * 2) / 0.015)));
}
function inferVocalDurationSeconds(lyrics?: string): number {
  const sectionCount = lyrics?.match(/^\s*\[[^\]]+\]\s*$/gm)?.length ?? 0;
  const words = (lyrics ?? "")
    .replace(/^\s*\[[^\]]+\]\s*$/gm, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  if (words === 0) return 180;
  const sungSeconds = (words / 75) * 60;
  const arrangementSeconds = Math.max(20, Math.min(45, sectionCount * 5));
  return Math.max(60, Math.min(300, Math.round((sungSeconds + arrangementSeconds) / 5) * 5));
}
function vocalSongCredits(seconds: number, creditsPerMinute = 18): number {
  const boundedSeconds = Math.min(Math.max(Math.round(seconds || 180), 60), 300);
  return Math.ceil((boundedSeconds / 60) * creditsPerMinute);
}
function formatVocalDuration(seconds: number): string {
  if (seconds % 60 === 0) return `${seconds / 60} min`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
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

async function readApiResponse(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { error: res.ok ? "The music engine returned an unreadable response." : "The music engine had an internal error. Please try again." };
  }
}

export default function Soundtracks() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  const [prompt, setPrompt] = useState("");
  const [lengthKey, setLengthKey] = useState("loop10");
  const [loopKey, setLoopKey] = useState("off");
  const [withVocals, setWithVocals] = useState(false);
  const [lyricsTopic, setLyricsTopic] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [vocalStyle, setVocalStyle] = useState("auto");
  const [explicit, setExplicit] = useState(false);
  const [bpm, setBpm] = useState("");
  const [lyricsBusy, setLyricsBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [libSearch, setLibSearch] = useState("");
  const [libSort, setLibSort] = useState<"new" | "old" | "name">("new");
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [topUpCost, setTopUpCost] = useState(0);
  const duration = LENGTH_OPTIONS.find((l) => l.key === lengthKey)?.seconds ?? 10;
  const loopToSeconds = withVocals ? 0 : LOOP_OPTIONS.find((l) => l.key === loopKey)?.seconds ?? 0;

  // Write or enhance lyrics via the Prompt Studio lyrics engine (3 credits when
  // an LLM is configured). "enhance" polishes the current draft; "write" drafts
  // fresh lyrics from the vibe prompt.
  const writeLyrics = async (mode: "write" | "enhance") => {
    if (mode === "write" && lyricsTopic.trim().length < 2) {
      toast({
        title: "Add a song topic",
        description: "Tell the lyric writer what the song should be about.",
        variant: "destructive",
      });
      return;
    }
    if (mode === "enhance" && lyrics.trim().length < 2) {
      toast({
        title: "Add lyrics to enhance",
        description: "Type or paste your existing lyrics into the editor first.",
        variant: "destructive",
      });
      return;
    }
    // Proactive credit check — show the top-up modal instead of letting the
    // user hit a backend failure after submitting.
    if (!canAffordCredits(LYRICS_BUILD_COST, status?.creditsRemaining)) {
      setTopUpCost(LYRICS_BUILD_COST);
      setTopUpOpen(true);
      return;
    }
    setLyricsBusy(true);
    try {
      const extras = { explicit, bpm: bpm.trim() ? Number(bpm) : undefined };
      const body =
        mode === "enhance"
          ? { lyrics: lyrics.trim(), theme: lyricsTopic.trim() || undefined, ...extras }
          : { theme: lyricsTopic.trim(), ...extras };
      const res = await fetch("/api/prompt/lyrics", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await readApiResponse(res);
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Couldn't generate lyrics");
      setLyrics(typeof data.lyrics === "string" ? data.lyrics.trim() : "");
      toast({
        title: mode === "enhance" ? "Lyrics enhanced" : "Lyrics written",
        description: typeof data.charged === "number" && data.charged > 0 ? `${data.charged} credits used.` : undefined,
      });
      queryClient.invalidateQueries({ queryKey: ["soundtracks", "status"] });
    } catch (e) {
      toast({
        title: "Couldn't generate lyrics",
        description: e instanceof Error ? e.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setLyricsBusy(false);
    }
  };

  const { data: status } = useQuery<StatusResp>({
    queryKey: ["soundtracks", "status"],
    queryFn: async () => {
      const res = await fetch("/api/music/soundtracks-status", { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: isAuthenticated,
  });
  const estimatedVocalDuration = inferVocalDurationSeconds(lyrics);
  const estimatedVocalCredits = vocalSongCredits(
    estimatedVocalDuration,
    status?.vocalCreditsPerMinute ?? Math.ceil((status?.vocalCost ?? 54) / 3),
  );

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
      // Fold the chosen vocal style (male/female/duet/…) into the prompt — the
      // song model reads the voice from the prompt text.
      const styleDesc = VOCAL_STYLES.find((s) => s.key === vocalStyle)?.desc;
      const effectivePrompt = withVocals && styleDesc ? `${prompt.trim()}, ${styleDesc}` : prompt;
      const res = await fetch("/api/admin/music/generate", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: effectivePrompt,
          ...(withVocals
            ? {
                withVocals: true,
                // Typed lyrics win; otherwise let the model write them from the vibe.
                ...(lyrics.trim() ? { lyrics: lyrics.trim() } : { lyricsOptimizer: true }),
              }
            : {
                durationSeconds: duration,
                ...(loopToSeconds > duration ? { loopToSeconds } : {}),
              }),
        }),
      });
      const data = await readApiResponse(res);
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "The music engine couldn't finish this track. Please try again.");
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
  // Handoff from Prompt Studio: /soundtracks?prompt=&lyrics=&vocals=1 prefills the
  // vibe, drops in the lyrics, and flips on the vocals toggle.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const p = q.get("prompt");
    const l = q.get("lyrics");
    const v = q.get("vocals");
    if (!p && !l && !v) return;
    if (p) setPrompt(p);
    if (l) setLyrics(l);
    if (v === "1" || l) setWithVocals(true);
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
    mutationFn: async ({
      id,
      isPublic,
      isCreatorAnonymous,
      copyLink,
    }: {
      id: string;
      isPublic: boolean;
      isCreatorAnonymous?: boolean;
      copyLink?: boolean;
    }) => {
      const res = await fetch(`/api/music/soundtracks/${id}/public`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isPublic,
          ...(isCreatorAnonymous === undefined ? {} : { isCreatorAnonymous }),
        }),
      });
      if (!res.ok) throw new Error("Update failed");
      return res.json() as Promise<{
        isPublic: boolean;
        isCreatorAnonymous: boolean;
        shareToken: string;
        sharePath: string;
      }>;
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["soundtracks"] });
      if (data.isPublic && variables.copyLink) {
        const link = `${window.location.origin}${data.sharePath}`;
        navigator.clipboard?.writeText(link).catch(() => {});
        toast({
          title: data.isCreatorAnonymous ? "Posted anonymously — link copied" : "Posted to Explore — link copied",
          description: link,
        });
      } else if (data.isPublic) {
        toast({
          title: data.isCreatorAnonymous ? "Now posted anonymously" : "Creator name is now visible",
        });
      } else {
        toast({ title: "Set to private" });
      }
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
        <p className="text-muted-foreground mb-6">Sign in to create full vocal songs or instrumentals from a prompt—use them in videos or download and share your music on its own.</p>
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
    <>
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-8">
        <div className="max-w-2xl">
          <h1 className="text-3xl font-bold tracking-tight mb-2 flex items-center gap-2">
            <Music2 className="h-7 w-7 text-primary" /> Studio
          </h1>
          <p className="text-muted-foreground text-base">
            Compose original tracks from scratch. Start with a vibe, add lyrics if you want vocals, and produce high-fidelity music.
          </p>
        </div>
        {freeLabel && (
          <div className="hidden sm:flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-4 py-2 text-sm font-medium text-primary shadow-sm shrink-0">
            <Sparkles className="h-4 w-4" /> {freeLabel}
          </div>
        )}
      </div>

      <div className="mb-8">
        <TutorialTip
          id={withVocals ? "soundtracks-vocals" : "soundtracks"}
          title={withVocals ? "How vocal songs work" : "How Soundtracks work"}
        >
          {withVocals ? (
            <>
              Write or paste your own lyrics (or tap <strong>Write for me</strong>, then <strong>Enhance</strong> to
              polish them), choose a voice, and we'll generate a full royalty-free song whose length follows the
              lyrics and arrangement. Use [Verse] / [Chorus] / [Bridge] tags to shape it — or leave the lyrics blank
              and the model writes the words from your vibe.
            </>
          ) : (
            <>
              Describe a vibe (or tap a preset), pick a length, and generate a royalty-free instrumental. It saves to your
              library automatically — play it, download it, rename it, or drop it straight into a video.
            </>
          )}
        </TutorialTip>
      </div>

      <div className="bg-card border border-border shadow-sm rounded-2xl overflow-hidden mb-12">
        {/* Type Toggle */}
        <div className="flex border-b border-border bg-muted/20">
          <button
            type="button"
            onClick={() => setWithVocals(false)}
            className={`flex-1 py-4 text-sm font-semibold transition-all border-b-2 ${!withVocals ? "border-primary text-primary bg-background shadow-[0_2px_0_0_hsl(var(--primary))_inset]" : "border-transparent text-muted-foreground hover:bg-muted/40 hover:text-foreground"}`}
          >
            Instrumental
          </button>
          <button
            type="button"
            onClick={() => setWithVocals(true)}
            disabled={status?.vocalsEnabled === false}
            title={status?.vocalsEnabled === false ? "Vocal songs aren't available yet" : undefined}
            className={`flex-1 py-4 text-sm font-semibold transition-all border-b-2 disabled:opacity-40 disabled:cursor-not-allowed ${withVocals ? "border-primary text-primary bg-background shadow-[0_2px_0_0_hsl(var(--primary))_inset]" : "border-transparent text-muted-foreground hover:bg-muted/40 hover:text-foreground"}`}
          >
            With Vocals
          </button>
        </div>

        <div className="p-6 md:p-8 space-y-12">
          {status && !status.enabled ? (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-300 p-4 text-sm font-medium">
              Coming soon. Soundtracks isn't open on your account yet — check back shortly.
            </div>
          ) : (
            <>
              {/* 1. The Vibe */}
              <section className="space-y-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-sm">1</div>
                  <h2 className="text-xl font-semibold">The Sound</h2>
                </div>
                <div className="pl-10 space-y-4">
                  <Textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    rows={3}
                    placeholder={withVocals
                      ? "Describe the style & vibe — e.g. anthemic pop-rock, hopeful, driving beat, 120 BPM"
                      : "Describe the vibe — e.g. warm lofi hip hop, mellow Rhodes, vinyl crackle, 72 BPM"}
                    className="resize-none text-base min-h-[100px]"
                  />
                  <div className="flex flex-wrap gap-2">
                    {PRESETS.map((p) => (
                      <button key={p.label} type="button" onClick={() => setPrompt(p.prompt)} title={p.prompt}
                        className="text-xs px-3 py-1.5 rounded-full border border-border bg-background/50 text-muted-foreground hover:border-primary hover:text-primary transition-colors">
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
              </section>

              {/* 2. Vocals & Lyrics */}
              {withVocals && (
                <section className="space-y-5">
                  <div className="flex items-center gap-3">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-sm">2</div>
                    <div className="flex items-center gap-3">
                      <h2 className="text-xl font-semibold">Vocals & Lyrics</h2>
                       <Badge variant="secondary" className="font-medium text-xs">
                         {estimatedVocalCredits} credits est.
                       </Badge>
                    </div>
                  </div>
                  <div className="pl-10 space-y-8">
                    {/* Voice */}
                    <div className="space-y-3">
                      <Label className="text-base">Lead Voice</Label>
                      <div className="flex flex-wrap gap-2">
                        {VOCAL_STYLES.map((v) => (
                          <button key={v.key} type="button" onClick={() => setVocalStyle(v.key)}
                            className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${vocalStyle === v.key ? "border-primary bg-primary/10 text-primary" : "border-border bg-background/40 text-muted-foreground hover:border-primary/50"}`}>
                            {v.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Topic & Generator */}
                    <div className="space-y-4 p-5 rounded-xl border border-border bg-muted/10">
                      <div className="flex items-center justify-between">
                        <Label className="text-base font-semibold">AI Lyric Writer</Label>
                        <span className="text-xs text-muted-foreground font-medium">{LYRICS_BUILD_COST} credits per use</span>
                      </div>
                      <div className="flex flex-col sm:flex-row gap-3">
                        <div className="flex-1">
                           <Input
                             placeholder="What should the song be about? (e.g. Neon city nights, winning a race)"
                             value={lyricsTopic}
                             onChange={(e) => setLyricsTopic(e.target.value)}
                             className="bg-background"
                           />
                        </div>
                        <Button
                          onClick={() => writeLyrics("write")}
                          disabled={lyricsBusy || lyricsTopic.trim().length < 3}
                          variant="secondary"
                          className="shrink-0"
                        >
                          {lyricsBusy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
                          Write lyrics
                        </Button>
                      </div>

                      <div className="grid grid-cols-2 gap-4 pt-2">
                        <div>
                          <Label className="text-xs text-muted-foreground mb-1.5 block">Language</Label>
                          <div className="flex items-center gap-1 rounded-lg border border-border p-0.5 bg-background w-fit">
                            <button type="button" onClick={() => setExplicit(false)}
                              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${!explicit ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}>
                              Clean
                            </button>
                            <button type="button" onClick={() => setExplicit(true)}
                              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${explicit ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}>
                              Explicit
                            </button>
                          </div>
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground mb-1.5 block">Tempo (BPM) <span className="opacity-60 font-normal">Optional</span></Label>
                          <Input type="number" inputMode="numeric" min={40} max={240} value={bpm}
                            onChange={(e) => setBpm(e.target.value)} placeholder="e.g. 120"
                            className="w-24 bg-background h-8 text-sm" />
                        </div>
                      </div>
                    </div>

                    {/* Lyrics Textarea */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <Label className="text-base">Lyrics</Label>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => writeLyrics("enhance")}
                          disabled={lyricsBusy || lyrics.trim().length < 5}
                          className="h-8 text-primary hover:text-primary hover:bg-primary/10"
                        >
                          <Wand2 className="h-3.5 w-3.5 mr-1.5" /> Enhance existing lyrics ({LYRICS_BUILD_COST} credits)
                        </Button>
                      </div>
                      <Textarea
                        value={lyrics}
                        onChange={(e) => setLyrics(e.target.value)}
                        rows={8}
                        className="text-sm font-medium leading-relaxed resize-y bg-background"
                        placeholder="Type or paste your lyrics here. Use [Verse], [Chorus], and [Bridge] tags to structure the song.&#10;&#10;If you leave this blank, the song generator can write lyrics from your sound description at no extra charge."
                      />
                      <p className="text-xs text-muted-foreground">
                        Enhance existing lyrics rewrites the text in this editor while preserving its story and voice.
                        The song length follows the amount and structure of the lyrics. The topic above is optional guidance.
                      </p>
                    </div>
                  </div>
                </section>
              )}

              {/* Instrumental duration */}
              {!withVocals && <section className="space-y-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-sm">
                    2
                  </div>
                  <h2 className="text-xl font-semibold">Track Length</h2>
                </div>
                <div className="pl-10 space-y-6">
                  <div className="flex flex-wrap gap-2">
                    {LENGTH_OPTIONS.map((l) => (
                      <button key={l.key} type="button"
                        onClick={() => setLengthKey(l.key)}
                        className={`rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors ${lengthKey === l.key ? "border-primary bg-primary/10 text-primary" : "border-border bg-background/40 text-muted-foreground hover:border-primary/50"}`}>
                        {l.label}
                      </button>
                    ))}
                  </div>

                  <div className="space-y-3 pt-2">
                    <Label className="text-base block">Loop Target <span className="text-muted-foreground font-normal text-sm ml-2">Repeat the track to fill this duration (Free)</span></Label>
                    <div className="flex flex-wrap gap-2">
                      {LOOP_OPTIONS.map((l) => (
                        <button key={l.key} type="button" onClick={() => setLoopKey(l.key)}
                          className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${loopKey === l.key ? "border-primary bg-primary/10 text-primary" : "border-border bg-background/40 text-muted-foreground hover:border-primary/50"}`}>
                          {l.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </section>}
            </>
          )}
        </div>

        {/* Generate Footer */}
        {status && status.enabled && (
          <div className="bg-muted/30 border-t border-border p-6 md:px-8 flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="text-sm text-muted-foreground w-full md:w-auto text-center md:text-left">
              {withVocals
                ? `Estimated ${formatVocalDuration(estimatedVocalDuration)} vocal song: ${estimatedVocalCredits} credits.`
                : status?.admin || (status?.freeRemaining ?? 0) > 0
                  ? "You are using a free soundtrack generation."
                  : `Generating this soundtrack will use ≈ ${songCredits(duration)} credits.`}
            </div>

            {gen.isPending || progress > 0 ? (
              <div className="w-full md:w-80 flex flex-col gap-2 bg-background p-3 rounded-xl border border-border">
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
              </div>
            ) : (
              <Button
                size="lg"
                className="w-full md:w-auto bg-gradient-electric text-white text-base font-bold px-8 h-12 shadow-md hover:shadow-lg transition-all"
                disabled={prompt.trim().length < 3 || lyricsBusy}
                onClick={() => {
                  const generationIsFree = !withVocals && (status?.admin || (status?.freeRemaining ?? 0) > 0);
                  const requiredCredits = withVocals ? estimatedVocalCredits : generationIsFree ? 0 : songCredits(duration);
                  if (!canAffordCredits(requiredCredits, status?.creditsRemaining)) {
                    setTopUpCost(requiredCredits);
                    setTopUpOpen(true);
                    return;
                  }
                  gen.mutate();
                }}
              >
                <Sparkles className="h-5 w-5 mr-2" />
                Generate Track
              </Button>
            )}
          </div>
        )}
        {gen.isError && !gen.isPending && progress === 0 && (
          <div className="border-t border-destructive/20 bg-destructive/5 px-6 py-4 md:px-8">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-destructive">This track wasn’t generated</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {gen.error instanceof Error ? gen.error.message : "The music engine had an internal error. Please try again."}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">No soundtrack credits are charged unless generation succeeds.</p>
              </div>
              <Button variant="outline" onClick={() => gen.mutate()} disabled={lyricsBusy}>
                Try again
              </Button>
            </div>
          </div>
        )}
      </div>

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
                  {s.isPublic && (
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Badge variant="outline" className="text-[10px]">Public</Badge>
                      {s.isCreatorAnonymous && <Badge variant="outline" className="text-[10px]">Anonymous</Badge>}
                    </div>
                  )}
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
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8"
                        title={s.isCreatorAnonymous ? "Show your profile name on Explore" : "Hide your profile name on Explore"}
                        onClick={() =>
                          togglePublic.mutate({
                            id: s.id,
                            isPublic: true,
                            isCreatorAnonymous: !s.isCreatorAnonymous,
                          })
                        }
                      >
                        {s.isCreatorAnonymous ? "Anonymous" : "Post anonymously"}
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button size="sm" variant="outline" className="h-8" onClick={() => togglePublic.mutate({ id: s.id, isPublic: true, copyLink: true })}><Share2 className="h-3.5 w-3.5 mr-1.5" /> Post to Explore</Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8"
                        title="Post this soundtrack anonymously on Explore"
                        onClick={() =>
                          togglePublic.mutate({
                            id: s.id,
                            isPublic: true,
                            isCreatorAnonymous: true,
                            copyLink: true,
                          })
                        }
                      >
                        Post anonymously
                      </Button>
                    </>
                  )}
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive ml-auto"
                        aria-label={`Delete ${s.title || "soundtrack"}`}
                        title="Delete soundtrack"
                        disabled={del.isPending}
                      >
                        {del.isPending && del.variables === s.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete this soundtrack?</AlertDialogTitle>
                        <AlertDialogDescription>
                          “{s.title || "AI Soundtrack"}” will be removed from your library. This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => del.mutate(s.id)}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>

    <TopUpRequiredDialog
      open={topUpOpen}
      onOpenChange={setTopUpOpen}
      creditsRequired={topUpCost}
      creditsRemaining={status?.creditsRemaining ?? 0}
      title="More credits needed"
    />
    </>
  );
}
