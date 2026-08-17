import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Loader2, Search, ShieldCheck, Coins, Check, X,
  MessageSquare, Users, ChevronDown, ChevronUp,
  CircleDot, Clock, CheckCircle2, XCircle, RotateCcw, AlertTriangle, RefreshCw,
  Film, Ban, Trash2, Play, Music2, Sparkles, Scissors, Download,
  BarChart3, TrendingUp, Clock3, MousePointerClick, DollarSign, Share2, Gift, Copy, Mic2,
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip as RTooltip,
  CartesianGrid, LineChart, Line, Legend,
} from "recharts";
import { useToast } from "@/hooks/use-toast";
import LyricSyncStudio from "@/components/admin/LyricSyncStudio";

/* ─── User management types ─── */
interface AdminUser {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  subscriptionStatus: string;
  isDisabled: boolean;
  createdAt: string;
  creditsRemaining: number;
  subscriptionCredits: number;
  topupCredits: number;
  creditsUsed: number;
  totalGenerations: number;
  generatedVideos: number;
  remixVideos: number;
}

interface AdminUserVideo {
  id: string;
  videoObjectPath: string;
  thumbnailObjectPath: string | null;
  title: string | null;
  prompt: string | null;
  isPublic: boolean;
  createdAt: string;
}

async function fetchAdminUsers(search: string): Promise<AdminUser[]> {
  const params = search ? `?search=${encodeURIComponent(search)}` : "";
  const res = await fetch(`/api/admin/users${params}`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch users");
  const data = await res.json();
  return data.users;
}

async function setUserCredits(userId: string, amount: number): Promise<void> {
  const res = await fetch("/api/admin/credits/set", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ userId, amount }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error || "Failed to update credits");
  }
}

function statusColor(status: string) {
  switch (status) {
    case "active":    return "bg-green-500/15 text-green-600 border-green-500/30";
    case "trial":     return "bg-blue-500/15 text-blue-600 border-blue-500/30";
    case "cancelled": return "bg-red-500/15 text-red-500 border-red-500/30";
    default:          return "bg-muted text-muted-foreground border-border";
  }
}

function CreditCell({ user, onSaved }: { user: AdminUser; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(user.creditsRemaining));
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: (amount: number) => setUserCredits(user.id, amount),
    onSuccess: () => {
      toast({ title: "Credits updated", description: `${user.email} → ${value} credits` });
      setEditing(false);
      onSaved();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  function handleSave() {
    const parsed = parseInt(value, 10);
    if (isNaN(parsed) || parsed < 0) {
      toast({ title: "Invalid amount", description: "Enter a non-negative integer", variant: "destructive" });
      return;
    }
    mutation.mutate(parsed);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") handleSave();
    if (e.key === "Escape") { setEditing(false); setValue(String(user.creditsRemaining)); }
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <Input
          className="h-7 w-24 text-sm px-2"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus
          type="number"
          min={0}
        />
        <Button size="icon" className="h-7 w-7" onClick={handleSave} disabled={mutation.isPending} aria-label="Save credits">
          {mutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" aria-hidden="true" />}
        </Button>
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditing(false); setValue(String(user.creditsRemaining)); }} aria-label="Cancel edit">
          <X className="h-3 w-3" aria-hidden="true" />
        </Button>
      </div>
    );
  }

  return (
    <button
      onClick={() => { setValue(String(user.creditsRemaining)); setEditing(true); }}
      className="flex items-center gap-1.5 text-sm font-medium text-accent hover:underline underline-offset-2 cursor-pointer group"
      title="Click to edit"
    >
      <Coins className="h-3.5 w-3.5 shrink-0" />
      <span>{user.creditsRemaining.toLocaleString()}</span>
      <span className="text-xs text-muted-foreground font-normal opacity-0 group-hover:opacity-100 transition-opacity">
        ({user.subscriptionCredits}+{user.topupCredits})
      </span>
    </button>
  );
}

/* ─── User moderation row: playable videos + block/unblock ─── */
function UserRow({ user, onChanged }: { user: AdminUser; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [videos, setVideos] = useState<AdminUserVideo[] | null>(null);
  const [loadingVids, setLoadingVids] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const { toast } = useToast();

  async function toggleVideos() {
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (videos === null) {
      setLoadingVids(true);
      try {
        const res = await fetch(`/api/admin/users/${user.id}/videos`, { credentials: "include" });
        const data = await res.json();
        setVideos(data.videos ?? []);
      } catch {
        setVideos([]);
      } finally {
        setLoadingVids(false);
      }
    }
  }

  async function toggleBlock() {
    setBlocking(true);
    try {
      const res = await fetch(`/api/admin/users/${user.id}/disable`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disabled: !user.isDisabled }),
      });
      if (!res.ok) throw new Error("Request failed");
      toast({ title: user.isDisabled ? "User unblocked" : "User blocked", description: user.email ?? "" });
      onChanged();
    } catch {
      toast({ title: "Could not update block status", variant: "destructive" });
    } finally {
      setBlocking(false);
    }
  }

  return (
    <>
      <tr className={`hover:bg-muted/10 transition-colors ${user.isDisabled ? "opacity-60" : ""}`}>
        <td className="px-4 py-3">
          <div className="font-medium truncate max-w-[200px] flex items-center gap-2">
            {user.firstName || user.lastName
              ? [user.firstName, user.lastName].filter(Boolean).join(" ")
              : <span className="text-muted-foreground italic">No name</span>}
            {user.isDisabled && (
              <Badge variant="outline" className="text-[10px] bg-red-500/15 text-red-400 border-red-500/30">Blocked</Badge>
            )}
          </div>
          <div className="text-xs text-muted-foreground truncate max-w-[200px]">{user.email}</div>
        </td>
        <td className="px-4 py-3 hidden md:table-cell">
          <Badge variant="outline" className={`capitalize text-xs ${statusColor(user.subscriptionStatus)}`}>
            {user.subscriptionStatus}
          </Badge>
        </td>
        <td className="px-4 py-3">
          <CreditCell user={user} onSaved={onChanged} />
        </td>
        <td className="px-4 py-3 text-right hidden lg:table-cell whitespace-nowrap">
          <span title="AI-generated videos" className="text-foreground font-medium">{user.generatedVideos}</span>
          <span className="text-muted-foreground text-xs"> gen</span>
          <span className="mx-1.5 text-muted-foreground/40">·</span>
          <span title="Remix Lab videos" className="text-accent font-medium">{user.remixVideos}</span>
          <span className="text-muted-foreground text-xs"> remix</span>
        </td>
        <td className="px-4 py-3 text-right text-muted-foreground hidden lg:table-cell">
          {new Date(user.createdAt).toLocaleDateString()}
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center justify-end gap-1.5">
            <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs" onClick={toggleVideos}>
              <Film className="h-3.5 w-3.5" /> Videos
            </Button>
            <Button
              size="sm"
              variant={user.isDisabled ? "outline" : "ghost"}
              className={`h-7 gap-1.5 text-xs ${user.isDisabled ? "" : "text-red-400 hover:text-red-300"}`}
              disabled={blocking}
              onClick={toggleBlock}
            >
              {blocking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />}
              {user.isDisabled ? "Unblock" : "Block"}
            </Button>
          </div>
        </td>
      </tr>
      {open && (
        <tr className="bg-muted/5">
          <td colSpan={6} className="px-4 py-4">
            {loadingVids ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading videos…
              </div>
            ) : videos && videos.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {videos.map((v) => (
                  <div key={v.id} className="min-w-0">
                    <video
                      src={`/api/storage${v.videoObjectPath}`}
                      poster={v.thumbnailObjectPath ? `/api/storage${v.thumbnailObjectPath}` : undefined}
                      controls
                      preload="none"
                      className="w-full aspect-video rounded-md border border-border bg-black"
                    />
                    <div className="mt-1 truncate text-xs text-muted-foreground" title={v.title || v.prompt || ""}>
                      {v.title || v.prompt || "Untitled"}
                      {v.isPublic ? " · 🌐 public" : ""}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">This user has no videos.</div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

/* ─── Support ticket types ─── */
type TicketStatus = "open" | "in_progress" | "resolved" | "closed";
type TicketCategory = "billing" | "technical" | "content" | "other";

interface AdminTicket {
  id: string;
  userId: string;
  subject: string;
  message: string;
  category: TicketCategory;
  status: TicketStatus;
  jobId: string | null;
  adminNotes: string | null;
  createdAt: string;
  updatedAt: string;
  userEmail: string | null;
  userFirstName: string | null;
  userLastName: string | null;
}

function ticketStatusConfig(status: TicketStatus) {
  switch (status) {
    case "open":        return { label: "Open",        icon: CircleDot,    cls: "bg-blue-500/15 text-blue-400 border-blue-500/30" };
    case "in_progress": return { label: "In Progress", icon: Clock,        cls: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30" };
    case "resolved":    return { label: "Resolved",    icon: CheckCircle2, cls: "bg-green-500/15 text-green-400 border-green-500/30" };
    case "closed":      return { label: "Closed",      icon: XCircle,      cls: "bg-muted text-muted-foreground border-border" };
  }
}

const TICKET_STATUSES: TicketStatus[] = ["open", "in_progress", "resolved", "closed"];

function TicketRow({ ticket, onUpdate }: { ticket: AdminTicket; onUpdate: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [notes, setNotes] = useState(ticket.adminNotes ?? "");
  const [status, setStatus] = useState<TicketStatus>(ticket.status);
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/admin/support/${ticket.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status, adminNotes: notes }),
      });
      if (!res.ok) throw new Error("Failed to update");
    },
    onSuccess: () => {
      toast({ title: "Ticket updated" });
      onUpdate();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const { label, icon: Icon, cls } = ticketStatusConfig(ticket.status);
  const userName = [ticket.userFirstName, ticket.userLastName].filter(Boolean).join(" ") || ticket.userEmail || "Unknown";

  return (
    <div className="border border-border/50 rounded-xl overflow-hidden">
      <button
        className="w-full flex items-start gap-3 p-4 text-left hover:bg-muted/10 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="font-medium text-sm truncate max-w-xs">{ticket.subject}</span>
            <Badge variant="outline" className={`text-xs shrink-0 ${cls}`}>
              <Icon className="h-3 w-3 mr-1" />
              {label}
            </Badge>
            <span className="text-xs text-muted-foreground capitalize">{ticket.category}</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
            <span>{userName}</span>
            <span>·</span>
            <span>{new Date(ticket.createdAt).toLocaleString()}</span>
            {ticket.jobId && (
              <>
                <span>·</span>
                <Link href={`/jobs/${ticket.jobId}`} className="text-primary hover:underline font-mono" onClick={(e) => e.stopPropagation()}>
                  job
                </Link>
              </>
            )}
          </div>
        </div>
        <div className="shrink-0 text-muted-foreground mt-0.5">
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-border/40 pt-3">
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">User message</p>
            <p className="text-sm whitespace-pre-wrap bg-muted/20 rounded-lg p-3">{ticket.message}</p>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Status</label>
              <div className="flex flex-wrap gap-1.5">
                {TICKET_STATUSES.map((s) => {
                  const cfg = ticketStatusConfig(s);
                  return (
                    <button
                      key={s}
                      onClick={() => setStatus(s)}
                      className={`px-2.5 py-1 rounded-lg text-xs border transition-colors ${
                        status === s ? cfg.cls : "bg-card border-border text-muted-foreground hover:border-border"
                      }`}
                    >
                      {cfg.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="text-xs text-muted-foreground space-y-1">
              <p><span className="font-medium">From:</span> {ticket.userEmail}</p>
              <p><span className="font-medium">User ID:</span> <span className="font-mono">{ticket.userId.slice(0, 16)}…</span></p>
              {ticket.jobId && <p><span className="font-medium">Job ID:</span> <span className="font-mono">{ticket.jobId.slice(0, 16)}…</span></p>}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Response / Admin notes <span className="font-normal">(visible to user)</span>
            </label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Type a response or internal note…"
              rows={3}
              className="resize-none text-sm"
              maxLength={2000}
            />
          </div>

          <Button
            size="sm"
            className="bg-gradient-electric text-white"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Check className="h-3.5 w-3.5 mr-1.5" />}
            Save changes
          </Button>
        </div>
      )}
    </div>
  );
}

/* ─── Pending jobs types ─── */
interface PendingJob {
  id: string;
  userId: string;
  email: string | null;
  status: string;
  prompt: string | null;
  style: string | null;
  requestedDuration: string | null;
  audioSourceType: string | null;
  createdAt: string;
}

interface FailedJob extends PendingJob {
  errorMessage: string | null;
  retryCount: number | null;
  updatedAt: string;
}

/* ─── Admin song generator (Beta, admin-only) ─── */
// Descriptive lengths — no exact seconds shown to the user; "Full" lands
// around a natural 5-minute song.
const LENGTH_OPTIONS: { key: string; label: string; seconds: number }[] = [
  { key: "loop5", label: "5s loop", seconds: 5 },
  { key: "loop10", label: "10s loop", seconds: 10 },
  { key: "short", label: "~30s", seconds: 30 },
  { key: "medium", label: "~1 min", seconds: 60 },
  { key: "long", label: "~1.5 min", seconds: 90 },
  { key: "full", label: "Max (2 min)", seconds: 120 },
];

// Loop the (cheap) short clip to fill this length — free, matches your video.
const LOOP_OPTIONS: { key: string; label: string; seconds: number }[] = [
  { key: "off", label: "No loop", seconds: 0 },
  { key: "15", label: "15s", seconds: 15 },
  { key: "30", label: "30s", seconds: 30 },
  { key: "60", label: "1 min", seconds: 60 },
  { key: "90", label: "1.5 min", seconds: 90 },
  { key: "120", label: "2 min", seconds: 120 },
];

const INSTRUMENTAL_PRESETS: { label: string; prompt: string }[] = [
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

function AdminMusicPanel() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [prompt, setPrompt] = useState("");
  const [lengthKey, setLengthKey] = useState("loop10");
  const [loopKey, setLoopKey] = useState("off");
  const [result, setResult] = useState<{ url: string; provider: string; hasVocals: boolean; objectPath: string; loopedToSeconds?: number | null } | null>(null);

  const duration = LENGTH_OPTIONS.find((l) => l.key === lengthKey)?.seconds ?? 10;
  const loopToSeconds = LOOP_OPTIONS.find((l) => l.key === loopKey)?.seconds ?? 0;

  const { data: status } = useQuery<{ activeProvider: string; hasReplicateKey: boolean; aceStepReady: boolean; musicGenReady: boolean; lyricsProvider: string; musicModel?: string }>({
    queryKey: ["admin", "music", "status"],
    queryFn: async () => {
      const res = await fetch("/api/admin/music/status", { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    staleTime: 60_000,
  });

  const gen = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/music/generate", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          durationSeconds: duration,
          ...(loopToSeconds > duration ? { loopToSeconds } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Generation failed");
      return data as { url: string; provider: string; hasVocals: boolean; objectPath: string; loopedToSeconds?: number | null };
    },
    onSuccess: (data) => { setResult(data); toast({ title: "Soundtrack generated", description: "Saved to your library." }); },
    onError: (err: Error) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const requestVocals = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/music/request-vocals", { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error("Request failed");
      return res.json();
    },
    onSuccess: () => toast({ title: "Thanks — noted!", description: "We'll let you know when vocals & lyrics go live." }),
    onError: () => toast({ title: "Couldn't send", description: "Please try again.", variant: "destructive" }),
  });

  const isSim = status?.activeProvider === "simulation";

  return (
    <Card className="bg-card/50 border-card-border overflow-hidden">
      <div className="h-1 w-full bg-gradient-electric" />
      <CardHeader className="pb-4">
        <div className="flex items-center gap-2">
          <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
            <Music2 className="h-5 w-5 text-primary" />
          </div>
          <div>
            <CardTitle className="text-lg leading-tight">Soundtracks</CardTitle>
            <div className="flex items-center gap-1.5 mt-0.5">
              <Badge variant="outline" className="text-[10px]">Beta · Admin</Badge>
              <span className={`inline-flex items-center gap-1 text-[10px] ${isSim ? "text-amber-400" : "text-emerald-400"}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${isSim ? "bg-amber-400" : "bg-emerald-400"}`} />
                {isSim ? "Simulation" : "Live"}
              </span>
            </div>
          </div>
        </div>
        <CardDescription className="mt-2">
          Generate a royalty-free soundtrack, then drop it straight into a Remix or AI video. Subscribers get a batch of free Soundtracks every month (Starter 25 · Pro 100 · Studio 300); extra tracks cost credits.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        {isSim && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-300 px-3 py-2 text-xs">
            <b>Simulation mode</b> (placeholder audio). Set <code>PIXAZO_API_KEY</code> (same key as your video provider — recommended) or <code>REPLICATE_API_TOKEN</code> to generate real instrumentals.
          </div>
        )}

        {/* Describe */}
        <div>
          <label className="text-sm font-medium">Describe the instrumental</label>
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            placeholder="e.g. warm lofi hip hop, mellow Rhodes, vinyl crackle, 72 BPM"
            className="mt-1.5 resize-none"
            data-testid="admin-music-prompt"
          />
          <div className="flex flex-wrap gap-1.5 mt-2">
            {INSTRUMENTAL_PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => setPrompt(p.prompt)}
                className="text-xs px-2.5 py-1 rounded-full border border-border bg-background/40 text-muted-foreground hover:border-primary hover:text-primary transition-colors"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Clip length */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-sm font-medium">Clip length</label>
            <span className="text-xs text-muted-foreground" title="Charged for the clip you generate. Looping is free.">
              ≈ {songCredits(duration)} credits for users
            </span>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {LENGTH_OPTIONS.map((l) => (
              <button
                key={l.key}
                type="button"
                onClick={() => setLengthKey(l.key)}
                className={`rounded-lg border px-2 py-2 text-xs font-medium transition-colors ${
                  lengthKey === l.key ? "border-primary bg-primary/10 text-primary" : "border-border bg-background/40 text-muted-foreground hover:border-primary/50"
                }`}
                data-testid={`admin-music-length-${l.key}`}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>

        {/* Loop to fill */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-sm font-medium">Loop to fill</label>
            <span className="text-xs text-emerald-400/80">Free · repeats the clip</span>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {LOOP_OPTIONS.map((l) => {
              const dim = l.seconds > 0 && l.seconds <= duration; // no point looping to ≤ clip length
              return (
                <button
                  key={l.key}
                  type="button"
                  onClick={() => setLoopKey(l.key)}
                  disabled={dim}
                  className={`rounded-lg border px-2 py-2 text-xs font-medium transition-colors disabled:opacity-30 ${
                    loopKey === l.key ? "border-primary bg-primary/10 text-primary" : "border-border bg-background/40 text-muted-foreground hover:border-primary/50"
                  }`}
                  data-testid={`admin-music-loop-${l.key}`}
                >
                  {l.label}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1.5">
            Generate a cheap 5–10s loop and repeat it to any length — same low credit cost, perfect for backing a video.
          </p>
        </div>

        {/* Generate */}
        <Button
          onClick={() => gen.mutate()}
          disabled={gen.isPending || prompt.trim().length < 3}
          className="w-full h-11 bg-gradient-electric text-white shadow-glow"
        >
          {gen.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating… (up to a minute)</> : <><Sparkles className="mr-2 h-4 w-4" /> Generate instrumental</>}
        </Button>

        {/* Vocals request */}
        <div className="rounded-lg border border-dashed border-border bg-background/30 px-3 py-2.5 flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">🎤 Want <b className="text-foreground">vocals &amp; lyrics</b>? Not available yet.</span>
          <Button size="sm" variant="outline" onClick={() => requestVocals.mutate()} disabled={requestVocals.isPending} data-testid="request-vocals">
            {requestVocals.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Request it"}
          </Button>
        </div>

        {result && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/[0.06] p-4 space-y-3">
            <div className="text-sm font-semibold flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              Your soundtrack is ready
              {result.loopedToSeconds ? <Badge variant="outline" className="text-[10px]">Looped to {result.loopedToSeconds}s</Badge> : null}
              <span className="text-[11px] font-normal text-muted-foreground ml-auto">
                Saved to your <Link href="/soundtracks" className="text-primary hover:underline">library</Link>
              </span>
            </div>
            <audio src={result.url} controls className="w-full" />
            {(() => {
              const title = prompt.trim().split(/\s+/).slice(0, 4).join(" ") || "AI Soundtrack";
              return (
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" onClick={() => navigate(`/editor?audio=${encodeURIComponent(result.url)}&title=${encodeURIComponent(title)}`)} data-testid="song-to-remix">
                    <Scissors className="mr-1.5 h-3.5 w-3.5" /> Make a Remix video
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => navigate(`/generate?audioObjectPath=${encodeURIComponent(result.objectPath)}&title=${encodeURIComponent(title)}`)} data-testid="song-to-generate">
                    <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Generate a video
                  </Button>
                  <a href={result.url} download className="text-xs text-primary hover:underline ml-auto">Download</a>
                </div>
              );
            })()}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ─── Main admin page ─── */
type Tab = "analytics" | "users" | "support" | "jobs" | "deleted" | "music" | "lyricsync";

interface DeletedVideo {
  id: string;
  userId: string;
  email: string | null;
  title: string | null;
  durationSeconds: number | null;
  isPublic: boolean;
  createdAt: string;
  deletedAt: string | null;
}

function RecoverStat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className={`rounded-xl px-3 py-2.5 ${highlight ? "bg-primary/10" : "bg-muted/40"}`}>
      <div className={`text-lg font-bold ${highlight ? "text-primary" : ""}`}>{value}</div>
      <div className="text-[11px] text-muted-foreground leading-tight">{label}</div>
    </div>
  );
}

type RecoverableJob = {
  id: string;
  email: string | null;
  prompt: string | null;
  requestedDuration: string | null;
  resolution: string | null;
  reservedCredits: number;
  refunded: boolean;
  partialClips: number;
  pendingRequests: number;
  salvageable: boolean;
  updatedAt: string;
};
type RecoverReport = {
  jobs: RecoverableJob[];
  summary: {
    totalFailed: number;
    salvageable: number;
    reclaimableRequests: number;
    alreadyRenderedClips: number;
    refundedThatWouldRecharge: number;
  };
};

// Bulk-recover videos whose clips finished on Pixazo after the server stopped
// polling. Dry-run report first, then a single click re-queues the recoverable
// jobs (worker reclaims finished renders for free, regenerates only the rest).
function RecoverStrandedPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);

  const { data, isLoading, refetch, isFetching } = useQuery<RecoverReport>({
    queryKey: ["admin", "jobs", "recoverable"],
    queryFn: async () => {
      const res = await fetch("/api/admin/jobs/recoverable", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to scan");
      return res.json();
    },
    staleTime: 30_000,
  });

  const recover = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/jobs/recover", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        // Recover exactly the jobs the admin picked. onlyWithSalvage:false so an
        // explicitly-selected non-salvageable job isn't filtered out.
        body: JSON.stringify({ ids: [...selected], onlyWithSalvage: false }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Recovery failed");
      return d as { requeued: number; recharged: number; scanned: number };
    },
    onSuccess: (d) => {
      toast({
        title: `Re-queued ${d.requeued} job${d.requeued === 1 ? "" : "s"}`,
        description: d.recharged
          ? `${d.recharged} previously-refunded job(s) were re-charged (user receives the video).`
          : "Finished renders will be reclaimed with no new provider spend.",
      });
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ["admin", "jobs", "recoverable"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "jobs", "failed"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "jobs", "active"] });
    },
    onError: (err: Error) => toast({ title: "Recovery failed", description: err.message, variant: "destructive" }),
  });

  const s = data?.summary;
  const allJobs = data?.jobs ?? [];
  const visible = showAll ? allJobs : allJobs.filter((j) => j.salvageable);
  const visibleIds = visible.map((j) => j.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });

  return (
    <div className="mt-6 sm:mt-8">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base sm:text-lg font-semibold flex items-center gap-2">
          <RotateCcw className="h-4 w-4 text-primary" />
          Recover Stranded Renders
        </h2>
        <button
          onClick={() => refetch()}
          className="w-9 h-9 flex items-center justify-center rounded-full bg-muted/60 hover:bg-muted transition-colors"
        >
          <RefreshCw className={`h-4 w-4 text-muted-foreground ${isFetching ? "animate-spin" : ""}`} />
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-card/50 p-4 space-y-4">
          <p className="text-sm text-muted-foreground">
            Videos that failed after their clips finished on Pixazo can be re-queued — the worker reclaims
            finished renders for free and regenerates only what's missing.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <RecoverStat label="Failed jobs" value={s?.totalFailed ?? 0} />
            <RecoverStat label="Salvageable" value={s?.salvageable ?? 0} highlight />
            <RecoverStat label="Reclaimable renders" value={s?.reclaimableRequests ?? 0} />
            <RecoverStat label="Clips already made" value={s?.alreadyRenderedClips ?? 0} />
          </div>
          {!!s?.refundedThatWouldRecharge && (
            <p className="text-xs text-amber-500/90 bg-amber-500/10 rounded-lg px-3 py-2">
              {s.refundedThatWouldRecharge} of these were refunded on failure and will be re-charged if recovered
              (the user receives the finished video).
            </p>
          )}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={showAll}
                onChange={(e) => setShowAll(e.target.checked)}
                className="accent-primary"
              />
              Show all failed jobs (not just salvageable)
            </label>
            {visible.length > 0 && (
              <button onClick={toggleAll} className="text-xs font-medium text-primary hover:underline">
                {allVisibleSelected ? "Clear selection" : "Select all shown"}
              </button>
            )}
          </div>

          {visible.length > 0 ? (
            <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
              {visible.slice(0, 100).map((j) => (
                <label
                  key={j.id}
                  className={`flex items-start gap-2.5 text-xs rounded-lg px-3 py-2 cursor-pointer transition-colors ${
                    selected.has(j.id) ? "bg-primary/10 ring-1 ring-primary/40" : "bg-muted/30 hover:bg-muted/50"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(j.id)}
                    onChange={() => toggle(j.id)}
                    className="accent-primary mt-0.5"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-muted-foreground">{j.id.slice(0, 8)}…</span>
                      <span className="text-muted-foreground truncate max-w-[160px]">{j.email ?? "—"}</span>
                      {(j.requestedDuration || j.resolution) && (
                        <span className="text-muted-foreground/70">
                          {[j.requestedDuration, j.resolution].filter(Boolean).join(" · ")}
                        </span>
                      )}
                    </div>
                    {j.prompt && <p className="text-muted-foreground/80 truncate mt-0.5">{j.prompt}</p>}
                  </div>
                  <span className="flex flex-wrap gap-1.5 justify-end shrink-0">
                    {j.partialClips > 0 && <Badge variant="outline" className="text-xs">{j.partialClips} made</Badge>}
                    {j.pendingRequests > 0 && (
                      <Badge variant="outline" className="text-xs border-primary/40 text-primary">{j.pendingRequests} reclaimable</Badge>
                    )}
                    {!j.salvageable && (
                      <Badge variant="outline" className="text-xs border-muted-foreground/40 text-muted-foreground">full regen</Badge>
                    )}
                    {j.refunded && (
                      <Badge variant="outline" className="text-xs border-amber-500/40 text-amber-500">refunded</Badge>
                    )}
                  </span>
                </label>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">
              No {showAll ? "failed" : "salvageable"} jobs.
            </p>
          )}

          <button
            disabled={recover.isPending || selected.size === 0}
            onClick={() => recover.mutate()}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-primary text-primary-foreground font-semibold hover:opacity-90 disabled:opacity-50 transition-colors"
          >
            {recover.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
            {selected.size === 0 ? "Select jobs to recover" : `Recover ${selected.size} selected`}
          </button>
        </div>
      )}
    </div>
  );
}

/* ─── Analytics dashboard ─── */
interface AnalyticsOverview {
  days: number;
  funnel: { visitors: number; signups: number; activated: number; paid: number };
  timePerPage: { path: string; views: number; avgSeconds: number; totalMinutes: number }[];
  featureUsage: {
    aiVideos: number; remixRenders: number; instrumentals: number; vocalSongs: number;
    generationsPaid: number; generationsTrial: number;
  };
  keyActions: {
    shareClip: number; referralShare: number; referralCopy: number;
    checkoutStart: number; checkoutIntentLoggedOut: number;
  };
  sources: { source: string; visitors: number }[];
  landingPages: { path: string; visitors: number }[];
  trend: { day: string; visitors: number; signups: number }[];
}

function pct(part: number, whole: number): string {
  if (!whole) return "—";
  return `${Math.round((part / whole) * 1000) / 10}%`;
}

function StatCard({ icon: Icon, label, value, sub }: { icon: React.ElementType; label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function AnalyticsPanel() {
  const [days, setDays] = useState(30);
  const { data, isLoading, isError } = useQuery<AnalyticsOverview>({
    queryKey: ["admin-analytics", days],
    queryFn: async () => {
      const res = await fetch(`/api/admin/analytics/overview?days=${days}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load analytics");
      return res.json();
    },
    refetchInterval: 60_000,
  });

  const funnelSteps = data
    ? [
        { key: "Visitors", value: data.funnel.visitors, of: data.funnel.visitors },
        { key: "Signups", value: data.funnel.signups, of: data.funnel.visitors },
        { key: "Made something", value: data.funnel.activated, of: data.funnel.signups },
        { key: "Paid", value: data.funnel.paid, of: data.funnel.signups },
      ]
    : [];
  const maxFunnel = data ? Math.max(1, data.funnel.visitors) : 1;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-muted-foreground max-w-xl">
          Where people spend time and where they drop off on the way to paying. Data comes from your own site — no third-party trackers.
        </p>
        <div className="flex items-center gap-1 rounded-lg border border-border p-1">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                days === d ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground text-sm py-12 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading analytics…
        </div>
      )}
      {isError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          Couldn't load analytics. If this is the first run, make sure the analytics_events migration has been applied.
        </div>
      )}

      {data && (
        <>
          {/* Funnel */}
          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="text-sm font-semibold flex items-center gap-2 mb-4">
              <TrendingUp className="h-4 w-4 text-primary" /> Conversion funnel
              <span className="text-xs font-normal text-muted-foreground">last {data.days} days</span>
            </h3>
            <div className="space-y-3">
              {funnelSteps.map((s, i) => (
                <div key={s.key}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="font-medium">{s.key}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {s.value.toLocaleString()}
                      {i > 0 && <span className="ml-2 text-xs">({pct(s.value, s.of)} of prev)</span>}
                    </span>
                  </div>
                  <div className="h-2.5 rounded-full bg-secondary/60 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-electric"
                      style={{ width: `${Math.max(2, Math.round((s.value / maxFunnel) * 100))}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-4">
              Overall visitor → paid: <strong className="text-foreground">{pct(data.funnel.paid, data.funnel.visitors)}</strong>.
              The biggest gap is your best place to focus.
            </p>
          </div>

          {/* Trend */}
          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="text-sm font-semibold flex items-center gap-2 mb-4">
              <TrendingUp className="h-4 w-4 text-primary" /> Visitors & signups per day
            </h3>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.trend} margin={{ top: 5, right: 10, bottom: 5, left: -10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
                  <RTooltip
                    contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="visitors" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} name="Visitors" />
                  <Line type="monotone" dataKey="signups" stroke="#22c55e" strokeWidth={2} dot={false} name="Signups" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Feature usage */}
          <div>
            <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
              <Sparkles className="h-4 w-4 text-primary" /> What people make
            </h3>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <StatCard icon={Film} label="AI videos" value={data.featureUsage.aiVideos.toLocaleString()} />
              <StatCard icon={Scissors} label="Remix renders" value={data.featureUsage.remixRenders.toLocaleString()} />
              <StatCard icon={Music2} label="Instrumentals" value={data.featureUsage.instrumentals.toLocaleString()} />
              <StatCard icon={Music2} label="Vocal songs" value={data.featureUsage.vocalSongs.toLocaleString()} />
            </div>
            <div className="grid grid-cols-2 gap-3 mt-3">
              <StatCard icon={DollarSign} label="Generations by paid users" value={data.featureUsage.generationsPaid.toLocaleString()} />
              <StatCard icon={MousePointerClick} label="Generations by trial users" value={data.featureUsage.generationsTrial.toLocaleString()} />
            </div>
          </div>

          {/* Growth loop — share & referral actions */}
          {data.keyActions && (
            <div>
              <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
                <Share2 className="h-4 w-4 text-primary" /> Growth loop
                <span className="text-xs font-normal text-muted-foreground">shares & referrals drive new visitors</span>
              </h3>
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                <StatCard icon={Share2} label="Clips shared" value={data.keyActions.shareClip.toLocaleString()} />
                <StatCard icon={Gift} label="Referral shares" value={data.keyActions.referralShare.toLocaleString()} />
                <StatCard icon={Copy} label="Referral copies" value={data.keyActions.referralCopy.toLocaleString()} />
                <StatCard icon={DollarSign} label="Checkout starts" value={data.keyActions.checkoutStart.toLocaleString()} />
                <StatCard icon={MousePointerClick} label="Checkout (logged out)" value={data.keyActions.checkoutIntentLoggedOut.toLocaleString()} sub="wanted to pay before signing in" />
              </div>
            </div>
          )}

          {/* Time per page */}
          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="text-sm font-semibold flex items-center gap-2 mb-4">
              <Clock3 className="h-4 w-4 text-primary" /> Where attention goes
            </h3>
            {data.timePerPage.length === 0 ? (
              <p className="text-sm text-muted-foreground">No time-on-page data yet — it starts collecting as people browse.</p>
            ) : (
              <div className="overflow-x-auto -mx-5 px-5">
                <table className="w-full text-sm min-w-[420px]">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground border-b border-border">
                      <th className="py-2 font-medium">Page</th>
                      <th className="py-2 font-medium text-right">Views</th>
                      <th className="py-2 font-medium text-right">Avg time</th>
                      <th className="py-2 font-medium text-right">Total time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.timePerPage.map((p) => (
                      <tr key={p.path} className="border-b border-border/40">
                        <td className="py-2 font-mono text-xs truncate max-w-[200px]">{p.path}</td>
                        <td className="py-2 text-right tabular-nums">{p.views.toLocaleString()}</td>
                        <td className="py-2 text-right tabular-nums">{p.avgSeconds}s</td>
                        <td className="py-2 text-right tabular-nums">{p.totalMinutes} min</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Traffic sources + landing pages */}
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-border bg-card p-5">
              <h3 className="text-sm font-semibold flex items-center gap-2 mb-4">
                <MousePointerClick className="h-4 w-4 text-primary" /> Where visitors come from
              </h3>
              {data.sources.length === 0 ? (
                <p className="text-sm text-muted-foreground">No traffic data yet.</p>
              ) : (
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.sources} layout="vertical" margin={{ left: 20, right: 10 }}>
                      <XAxis type="number" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
                      <YAxis type="category" dataKey="source" width={90} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                      <RTooltip
                        contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                      />
                      <Bar dataKey="visitors" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} name="Visitors" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
            <div className="rounded-xl border border-border bg-card p-5">
              <h3 className="text-sm font-semibold flex items-center gap-2 mb-4">
                <Film className="h-4 w-4 text-primary" /> Top landing pages
              </h3>
              {data.landingPages.length === 0 ? (
                <p className="text-sm text-muted-foreground">No landing-page data yet.</p>
              ) : (
                <table className="w-full text-sm">
                  <tbody>
                    {data.landingPages.map((p) => (
                      <tr key={p.path} className="border-b border-border/40">
                        <td className="py-2 font-mono text-xs truncate max-w-[220px]">{p.path}</td>
                        <td className="py-2 text-right tabular-nums">{p.visitors.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function AdminPage() {
  const [, setLocation] = useLocation();
  const { user, isLoading: isAuthLoading } = useAuth();
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>("users");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [ticketSearch, setTicketSearch] = useState("");
  const [ticketStatus, setTicketStatus] = useState("open");
  const queryClient = useQueryClient();

  const isAdmin = user?.isAdmin ?? false;

  const { data: users, isLoading: usersLoading, error: usersError, refetch: refetchUsers } = useQuery({
    queryKey: ["admin", "users", debouncedSearch],
    queryFn: () => fetchAdminUsers(debouncedSearch),
    enabled: isAdmin && tab === "users",
    staleTime: 30_000,
  });

  const { data: pendingJobsData, isLoading: pendingJobsLoading, refetch: refetchPendingJobs } = useQuery<{ jobs: PendingJob[] }>({
    queryKey: ["admin", "jobs", "pending"],
    queryFn: async () => {
      const res = await fetch("/api/admin/jobs/pending", { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: isAdmin && tab === "jobs",
    staleTime: 10_000,
    refetchInterval: tab === "jobs" ? 15_000 : false,
  });

  const { data: failedJobsData, isLoading: failedJobsLoading, refetch: refetchFailedJobs } = useQuery<{ jobs: FailedJob[] }>({
    queryKey: ["admin", "jobs", "failed"],
    queryFn: async () => {
      const res = await fetch("/api/admin/jobs/failed", { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: isAdmin && tab === "jobs",
    staleTime: 30_000,
  });

  const { data: liveData } = useQuery<{ count: number; windowSec: number; users: { userId: string; email: string | null; name: string | null; secondsAgo: number }[] }>({
    queryKey: ["admin", "active-users"],
    queryFn: async () => {
      const res = await fetch("/api/admin/active-users", { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: isAdmin && tab === "users",
    refetchInterval: tab === "users" ? 15_000 : false,
  });

  const approveMutation = useMutation({
    mutationFn: async (jobId: string) => {
      const res = await fetch(`/api/admin/jobs/${jobId}/approve`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to approve");
    },
    onSuccess: () => {
      toast({ title: "Job approved", description: "Job moved to queue and will process shortly." });
      refetchPendingJobs();
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const rejectMutation = useMutation({
    mutationFn: async (jobId: string) => {
      const res = await fetch(`/api/admin/jobs/${jobId}/reject`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to reject");
    },
    onSuccess: () => {
      toast({ title: "Job rejected", description: "Job has been marked as failed." });
      refetchPendingJobs();
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const retryMutation = useMutation({
    mutationFn: async (jobId: string) => {
      const res = await fetch(`/api/admin/jobs/${jobId}/retry`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to retry");
    },
    onSuccess: () => {
      toast({ title: "Job requeued", description: "Job has been reset and will process shortly." });
      refetchFailedJobs();
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  // ── Attach provider-rendered clips to a job by URL (rescue stranded clips) ──
  const [attachJobId, setAttachJobId] = useState("");
  const [attachLines, setAttachLines] = useState("");
  const attachMutation = useMutation({
    mutationFn: async () => {
      const jobId = attachJobId.trim();
      if (!jobId) throw new Error("Enter the job ID");
      // Each line: "<index> <url>" — also accepts "index: url" or "index,url".
      const clips = attachLines
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((line) => {
          const m = line.match(/^(\d+)\s*[:, ]\s*(https:\/\/\S+)$/);
          if (!m) throw new Error(`Can't read line: "${line.slice(0, 60)}" — use "index url" (e.g. "9 https://…")`);
          return { index: parseInt(m[1]!, 10), url: m[2]! };
        });
      if (!clips.length) throw new Error("Add at least one line: index followed by the clip link");
      const res = await fetch(`/api/admin/jobs/${jobId}/attach-clips`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clips }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? `Failed (${res.status})`);
      return data as { ok: boolean; attached: number; results: { index: number; ok: boolean; error?: string }[] };
    },
    onSuccess: (data) => {
      const failed = data.results.filter((r) => !r.ok);
      if (failed.length) {
        toast({
          title: `Attached ${data.attached}, ${failed.length} failed`,
          description: failed.map((f) => `#${f.index}: ${f.error}`).join(" · ").slice(0, 300),
          variant: "destructive",
        });
      } else {
        toast({ title: `Attached ${data.attached} clip${data.attached === 1 ? "" : "s"}`, description: "The job will reuse them on its next run — no re-render cost." });
        setAttachLines("");
      }
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const finalizeMutation = useMutation({
    mutationFn: async () => {
      const jobId = attachJobId.trim();
      if (!jobId) throw new Error("Enter the job ID");
      const res = await fetch(`/api/admin/jobs/${jobId}/finalize-partial`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? `Failed (${res.status})`);
      return data as { ok: boolean; savedClips: number; pendingRequests: number };
    },
    onSuccess: (data) => {
      toast({
        title: "Finalizing with saved clips",
        description: `Stopping generation and stitching the ${data.savedClips} saved clip${data.savedClips === 1 ? "" : "s"} into a finished video — no new provider spend.`,
      });
      queryClient.invalidateQueries({ queryKey: ["admin", "jobs"] });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const {
    data: deletedVideosData,
    isLoading: deletedLoading,
    refetch: refetchDeleted,
  } = useQuery<{ videos: DeletedVideo[] }>({
    queryKey: ["admin", "deleted-videos"],
    queryFn: async () => {
      const res = await fetch("/api/admin/deleted-videos", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load deleted videos");
      return res.json();
    },
    enabled: isAdmin && tab === "deleted",
    staleTime: 15_000,
  });

  const purgeMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/admin/videos/${id}/purge`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to permanently delete");
    },
    onSuccess: () => {
      toast({ title: "Permanently deleted", description: "The video and its files were removed." });
      refetchDeleted();
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoadingId, setPreviewLoadingId] = useState<string | null>(null);

  async function previewDeletedVideo(id: string) {
    setPreviewLoadingId(id);
    try {
      const res = await fetch(`/api/admin/videos/${id}/preview-url`, { credentials: "include" });
      if (!res.ok) throw new Error();
      const { url } = (await res.json()) as { url: string };
      setPreviewUrl(url);
    } catch {
      toast({ title: "Preview unavailable", description: "The video file may already be gone.", variant: "destructive" });
    } finally {
      setPreviewLoadingId(null);
    }
  }

  const { data: ticketsData, isLoading: ticketsLoading, refetch: refetchTickets } = useQuery<{ tickets: AdminTicket[] }>({
    queryKey: ["admin", "support", ticketStatus, ticketSearch],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (ticketSearch) params.set("search", ticketSearch);
      if (ticketStatus && ticketStatus !== "all") params.set("status", ticketStatus);
      const res = await fetch(`/api/admin/support?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: isAdmin && tab === "support",
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!isAuthLoading && !isAdmin) setLocation("/");
  }, [isAuthLoading, isAdmin, setLocation]);

  if (isAuthLoading || (!isAdmin && !isAuthLoading)) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  function handleSearchChange(e: React.ChangeEvent<HTMLInputElement>) {
    setSearch(e.target.value);
    clearTimeout((window as unknown as { _adminSearchTimer?: ReturnType<typeof setTimeout> })._adminSearchTimer);
    (window as unknown as { _adminSearchTimer?: ReturnType<typeof setTimeout> })._adminSearchTimer = setTimeout(() => {
      setDebouncedSearch(e.target.value);
    }, 350);
  }

  const openCount = ticketsData?.tickets.filter((t) => t.status === "open").length ?? 0;

  return (
    <div className="container mx-auto px-4 py-6 sm:py-12 max-w-6xl">
      <div className="flex items-center gap-3 mb-6 sm:mb-8">
        <div className="flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-lg bg-primary/10 shrink-0">
          <ShieldCheck className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Admin</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">Manage users, credits, and support tickets</p>
        </div>
      </div>

      {/* Tab bar — scrollable on mobile */}
      <div className="flex gap-1 mb-6 border-b border-border/50 overflow-x-auto scrollbar-none -mx-4 px-4 sm:mx-0 sm:px-0">
        <button
          onClick={() => setTab("analytics")}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
            tab === "analytics"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <BarChart3 className="h-4 w-4" />
          Analytics
        </button>
        <button
          onClick={() => setTab("users")}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
            tab === "users"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Users className="h-4 w-4" />
          Users
        </button>
        <button
          onClick={() => setTab("support")}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
            tab === "support"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <MessageSquare className="h-4 w-4" />
          Support
          {openCount > 0 && (
            <span className="ml-1 px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground text-xs font-mono leading-none">
              {openCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab("jobs")}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
            tab === "jobs"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <ShieldCheck className="h-4 w-4" />
          Job Approvals
          {pendingJobsData && pendingJobsData.jobs.length > 0 && (
            <span className="ml-1 px-1.5 py-0.5 rounded-full bg-yellow-500 text-black text-xs font-mono leading-none">
              {pendingJobsData.jobs.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab("deleted")}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
            tab === "deleted"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Trash2 className="h-4 w-4" />
          Deleted Files
        </button>
        <button
          onClick={() => setTab("music")}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
            tab === "music"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Music2 className="h-4 w-4" />
          Soundtracks
          <span className="ml-1 px-1.5 py-0.5 rounded-full bg-primary/20 text-primary text-[10px] font-mono leading-none">Beta</span>
        </button>
        <button
          onClick={() => setTab("lyricsync")}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
            tab === "lyricsync"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Mic2 className="h-4 w-4" />
          Lyric Sync
          <span className="ml-1 px-1.5 py-0.5 rounded-full bg-primary/20 text-primary text-[10px] font-mono leading-none">Beta</span>
        </button>
      </div>

      {tab === "analytics" && <AnalyticsPanel />}

      {tab === "music" && <AdminMusicPanel />}

      {tab === "lyricsync" && <LyricSyncStudio />}

      {/* ── Users tab ── */}
      {tab === "users" && (
        <>
        <Card className="bg-card/50 border-card-border mb-4">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
              </span>
              Live now · {liveData?.count ?? 0}
            </CardTitle>
            <CardDescription>Signed-in users active in the last {liveData?.windowSec ?? 120}s (updates every 15s).</CardDescription>
          </CardHeader>
          <CardContent>
            {!liveData || liveData.users.length === 0 ? (
              <p className="text-sm text-muted-foreground">No one's online right now.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {liveData.users.map((u) => (
                  <div key={u.userId} className="flex items-center gap-2 rounded-full border border-border bg-background/40 px-3 py-1 text-sm">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    <span className="font-medium">{u.name || u.email || "User"}</span>
                    <span className="text-xs text-muted-foreground">{u.secondsAgo < 20 ? "now" : `${u.secondsAgo}s ago`}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-card-border">
          <CardHeader className="pb-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <CardTitle className="text-lg">Users</CardTitle>
                <CardDescription>
                  {users ? `${users.length} user${users.length !== 1 ? "s" : ""}${debouncedSearch ? " matching" : ""}` : "Loading…"}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <a
                  href="/api/admin/users/export.csv"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background/40 px-3 py-2 text-sm font-medium text-muted-foreground hover:text-primary hover:border-primary/50 transition-colors whitespace-nowrap"
                  title="Download all users as a Resend-ready CSV"
                >
                  <Download className="h-4 w-4" /> Export CSV
                </a>
                <div className="relative flex-1 sm:w-72">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  <Input
                    className="pl-9"
                    placeholder="Search by email or name…"
                    value={search}
                    onChange={handleSearchChange}
                  />
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {usersLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : usersError ? (
              <div className="py-12 text-center text-sm text-destructive">
                Failed to load users.{" "}
                <button onClick={() => refetchUsers()} className="underline">Retry</button>
              </div>
            ) : !users || users.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                {debouncedSearch ? "No users match your search." : "No users found."}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/50 bg-muted/20">
                      <th className="px-4 py-3 text-left font-medium text-muted-foreground">User</th>
                      <th className="px-4 py-3 text-left font-medium text-muted-foreground hidden md:table-cell">Status</th>
                      <th className="px-4 py-3 text-left font-medium text-muted-foreground">Credits</th>
                      <th className="px-4 py-3 text-right font-medium text-muted-foreground hidden lg:table-cell">Videos (Gen · Remix)</th>
                      <th className="px-4 py-3 text-right font-medium text-muted-foreground hidden lg:table-cell">Joined</th>
                      <th className="px-4 py-3 text-right font-medium text-muted-foreground">Moderation</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/30">
                    {users.map((u) => (
                      <UserRow
                        key={u.id}
                        user={u}
                        onChanged={() => queryClient.invalidateQueries({ queryKey: ["admin", "users"] })}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
        </>
      )}

      {/* ── Job Approvals tab ── */}
      {tab === "jobs" && (
        <div className="space-y-4">
          {/* Section header */}
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base sm:text-lg font-semibold flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-purple-400" />
                Pending Approvals
                {pendingJobsData && pendingJobsData.jobs.length > 0 && (
                  <span className="text-xs bg-purple-500/20 text-purple-300 px-2 py-0.5 rounded-full font-medium">
                    {pendingJobsData.jobs.length}
                  </span>
                )}
              </h2>
              <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 hidden sm:block">
                Approved jobs are sent to the AI engine for processing.
              </p>
            </div>
            <button
              onClick={() => refetchPendingJobs()}
              className="w-9 h-9 flex items-center justify-center rounded-full bg-muted/60 hover:bg-muted transition-colors"
            >
              <RefreshCw className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>

          {pendingJobsLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !pendingJobsData?.jobs.length ? (
            <div className="text-center py-16 sm:py-20 border border-dashed border-border rounded-2xl bg-card/30">
              <ShieldCheck className="h-10 w-10 sm:h-12 sm:w-12 text-green-500 mx-auto mb-3 sm:mb-4 opacity-40" />
              <p className="text-foreground font-medium mb-1">All clear</p>
              <p className="text-muted-foreground text-sm">No jobs are waiting for approval.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {pendingJobsData.jobs.map((job) => (
                <div key={job.id} className="rounded-2xl overflow-hidden border border-border/60 bg-card/50">
                  {/* Job info */}
                  <div className="p-4 space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-mono text-muted-foreground">{job.id.slice(0, 8)}…</span>
                      <span className="text-xs text-muted-foreground">·</span>
                      <span className="text-xs text-muted-foreground truncate">{job.email ?? job.userId}</span>
                      <span className="text-xs text-muted-foreground ml-auto">{new Date(job.createdAt).toLocaleString()}</span>
                    </div>
                    <p className="text-sm font-medium leading-snug line-clamp-3">
                      {job.prompt ?? <span className="italic text-muted-foreground">No prompt</span>}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {job.style && <span className="capitalize bg-muted text-muted-foreground text-xs px-2 py-0.5 rounded-full">{job.style}</span>}
                      {job.requestedDuration && (
                        <span className="bg-muted text-muted-foreground text-xs px-2 py-0.5 rounded-full">
                          {job.requestedDuration === "full" ? "Full track" : `${job.requestedDuration}s`}
                        </span>
                      )}
                      {job.audioSourceType && <span className="bg-muted text-muted-foreground text-xs px-2 py-0.5 rounded-full capitalize">{job.audioSourceType}</span>}
                    </div>
                  </div>
                  {/* Action bar — full width on mobile, compact on desktop */}
                  <div className="flex border-t border-border/50">
                    <button
                      className="flex-1 flex items-center justify-center gap-2 py-3.5 sm:py-2.5 text-sm font-semibold text-red-400 hover:bg-red-500/10 active:bg-red-500/15 transition-colors border-r border-border/50 disabled:opacity-50"
                      disabled={rejectMutation.isPending || approveMutation.isPending}
                      onClick={() => rejectMutation.mutate(job.id)}
                    >
                      <X className="h-4 w-4" />
                      Reject
                    </button>
                    <button
                      className="flex-1 flex items-center justify-center gap-2 py-3.5 sm:py-2.5 text-sm font-semibold text-green-400 hover:bg-green-500/10 active:bg-green-500/15 transition-colors disabled:opacity-50"
                      disabled={approveMutation.isPending || rejectMutation.isPending}
                      onClick={() => approveMutation.mutate(job.id)}
                    >
                      <Check className="h-4 w-4" />
                      Approve
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Recover stranded renders ── */}
          <RecoverStrandedPanel />

          {/* ── Failed jobs ── */}
          <div className="mt-6 sm:mt-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base sm:text-lg font-semibold flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                Failed Jobs
                {failedJobsData && failedJobsData.jobs.length > 0 && (
                  <span className="text-xs bg-destructive/20 text-destructive px-2 py-0.5 rounded-full font-medium">
                    {failedJobsData.jobs.length}
                  </span>
                )}
              </h2>
              <button
                onClick={() => refetchFailedJobs()}
                className="w-9 h-9 flex items-center justify-center rounded-full bg-muted/60 hover:bg-muted transition-colors"
              >
                <RefreshCw className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>

            {failedJobsLoading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : !failedJobsData?.jobs.length ? (
              <div className="text-center py-12 border border-dashed border-border rounded-2xl bg-card/30">
                <CheckCircle2 className="h-10 w-10 text-green-500 mx-auto mb-3 opacity-40" />
                <p className="text-sm text-muted-foreground">No failed jobs.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {failedJobsData.jobs.map((job) => (
                  <div key={job.id} className="rounded-2xl overflow-hidden border border-destructive/20 bg-card/50">
                    <div className="p-4 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-mono text-muted-foreground">{job.id.slice(0, 8)}…</span>
                        <span className="text-xs text-muted-foreground">·</span>
                        <span className="text-xs text-muted-foreground truncate">{job.email ?? job.userId}</span>
                        {job.retryCount != null && (
                          <Badge variant="outline" className="text-xs border-destructive/40 text-destructive ml-auto">
                            {job.retryCount} retries
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm font-medium leading-snug line-clamp-2">
                        {job.prompt ?? <span className="italic text-muted-foreground">No prompt</span>}
                      </p>
                      {job.errorMessage && (
                        <p className="text-xs text-destructive/80 font-mono bg-destructive/5 rounded-lg px-2.5 py-1.5 line-clamp-2">
                          {job.errorMessage}
                        </p>
                      )}
                      <div className="flex flex-wrap gap-1.5">
                        {job.style && <span className="capitalize bg-muted text-muted-foreground text-xs px-2 py-0.5 rounded-full">{job.style}</span>}
                        {job.audioSourceType && <span className="bg-muted text-muted-foreground text-xs px-2 py-0.5 rounded-full capitalize">{job.audioSourceType}</span>}
                        <span className="bg-muted text-muted-foreground text-xs px-2 py-0.5 rounded-full">
                          Failed {new Date(job.updatedAt).toLocaleString()}
                        </span>
                      </div>
                    </div>
                    <div className="border-t border-border/50">
                      <button
                        className="w-full flex items-center justify-center gap-2 py-3.5 sm:py-2.5 text-sm font-semibold text-muted-foreground hover:bg-muted/30 active:bg-muted/50 transition-colors disabled:opacity-50"
                        disabled={retryMutation.isPending}
                        onClick={() => retryMutation.mutate(job.id)}
                      >
                        <RotateCcw className="h-4 w-4" />
                        Retry Job
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Attach stranded clips ── */}
          <div className="mt-6 sm:mt-8">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Attach Rendered Clips</CardTitle>
                <CardDescription>
                  Rescue clips that finished on the provider (visible in its dashboard) but never made it into a job.
                  Paste one line per clip: the clip number, a space, then the link — e.g. <span className="font-mono">9 https://…</span>.
                  The job reuses them on its next run instead of paying to re-render.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <input
                  value={attachJobId}
                  onChange={(e) => setAttachJobId(e.target.value)}
                  placeholder="Job ID (e.g. 03fbda07-6178-4451-a5a1-00ce12da9159)"
                  className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm font-mono placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
                <textarea
                  value={attachLines}
                  onChange={(e) => setAttachLines(e.target.value)}
                  placeholder={"9 https://provider.example/clip9.mp4\n10 https://provider.example/clip10.mp4"}
                  rows={5}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm font-mono placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
                />
                <button
                  onClick={() => attachMutation.mutate()}
                  disabled={attachMutation.isPending || !attachJobId.trim() || !attachLines.trim()}
                  className="w-full sm:w-auto flex items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground px-5 py-3 sm:py-2.5 text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {attachMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  {attachMutation.isPending ? "Downloading & attaching…" : "Attach Clips"}
                </button>
                <div className="pt-2 border-t border-border">
                  <p className="text-xs text-muted-foreground mb-2">
                    Or stop a stuck job and finish the video right now from the clips it already has (no new provider spend).
                    Uses the Job ID above — the clip links box can stay empty.
                  </p>
                  <button
                    onClick={() => finalizeMutation.mutate()}
                    disabled={finalizeMutation.isPending || !attachJobId.trim()}
                    className="w-full sm:w-auto flex items-center justify-center gap-2 rounded-xl border border-border bg-background px-5 py-3 sm:py-2.5 text-sm font-semibold hover:bg-muted transition-colors disabled:opacity-50"
                  >
                    {finalizeMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Scissors className="h-4 w-4" />}
                    {finalizeMutation.isPending ? "Requesting…" : "Finalize with Saved Clips"}
                  </button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* ── Deleted files tab ── */}
      {tab === "deleted" && (
        <>
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Deleted Files</CardTitle>
            <CardDescription>
              Videos users have deleted. They're hidden from users but stay on the site until purged
              (automatically after 30 days, or manually here). Permanent deletion removes the database
              record and the underlying files — this cannot be undone.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {deletedLoading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : !deletedVideosData || deletedVideosData.videos.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No deleted files.</p>
            ) : (
              <div className="space-y-2">
                {deletedVideosData.videos.map((v) => (
                  <div
                    key={v.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border/50 px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Film className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="text-sm font-medium truncate">{v.title || "Untitled video"}</span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 truncate">
                        {v.email || v.userId}
                        {v.deletedAt ? ` · deleted ${new Date(v.deletedAt).toLocaleDateString()}` : ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={previewLoadingId === v.id}
                        onClick={() => previewDeletedVideo(v.id)}
                      >
                        {previewLoadingId === v.id ? (
                          <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                        ) : (
                          <Play className="h-3.5 w-3.5 mr-1" />
                        )}
                        Preview
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={purgeMutation.isPending}
                        onClick={() => {
                          if (
                            window.confirm(
                              `Permanently delete "${v.title || "this video"}" and its files? This cannot be undone.`,
                            )
                          ) {
                            purgeMutation.mutate(v.id);
                          }
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-1" />
                        Delete forever
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        {previewUrl && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
            onClick={() => setPreviewUrl(null)}
          >
            <div className="relative w-full max-w-3xl" onClick={(e) => e.stopPropagation()}>
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <video src={previewUrl} controls autoPlay className="w-full rounded-lg shadow-xl bg-black" />
              <Button
                size="sm"
                variant="secondary"
                className="absolute -top-3 -right-3 h-8 w-8 p-0 rounded-full"
                onClick={() => setPreviewUrl(null)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
        </>
      )}

      {/* ── Support tab ── */}
      {tab === "support" && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
            <div className="flex flex-wrap gap-1.5">
              {["all", "open", "in_progress", "resolved", "closed"].map((s) => (
                <button
                  key={s}
                  onClick={() => setTicketStatus(s)}
                  className={`px-3 py-1.5 rounded-lg text-xs border transition-colors capitalize ${
                    ticketStatus === s
                      ? "bg-primary/15 border-primary/40 text-primary font-medium"
                      : "bg-card border-border text-muted-foreground hover:border-primary/30"
                  }`}
                >
                  {s === "in_progress" ? "In Progress" : s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                className="pl-9 h-9 text-sm"
                placeholder="Search tickets…"
                value={ticketSearch}
                onChange={(e) => setTicketSearch(e.target.value)}
              />
            </div>
          </div>

          {ticketsLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !ticketsData?.tickets.length ? (
            <div className="text-center py-20 border border-dashed border-border rounded-2xl bg-card/30">
              <MessageSquare className="h-12 w-12 text-muted-foreground mx-auto mb-4 opacity-20" />
              <p className="text-muted-foreground text-sm">No tickets found.</p>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">{ticketsData.tickets.length} ticket{ticketsData.tickets.length !== 1 ? "s" : ""}</p>
              {ticketsData.tickets.map((t) => (
                <TicketRow key={t.id} ticket={t} onUpdate={() => refetchTickets()} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
