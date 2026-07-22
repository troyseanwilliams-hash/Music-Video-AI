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
  Film, Ban, Trash2, Play, Music2, Sparkles, Scissors,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

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
        <Button size="icon" className="h-7 w-7" onClick={handleSave} disabled={mutation.isPending}>
          {mutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
        </Button>
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditing(false); setValue(String(user.creditsRemaining)); }}>
          <X className="h-3 w-3" />
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
  { key: "short", label: "Short (~30s)", seconds: 30 },
  { key: "medium", label: "Medium (~1 min)", seconds: 60 },
  { key: "long", label: "Long (~2.5 min)", seconds: 150 },
  { key: "full", label: "Full song (~5 min)", seconds: 300 },
];

function AdminMusicPanel() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [theme, setTheme] = useState("");
  const [prompt, setPrompt] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [lengthKey, setLengthKey] = useState("full");
  const [result, setResult] = useState<{ url: string; provider: string; hasVocals: boolean; objectPath: string } | null>(null);

  const duration = LENGTH_OPTIONS.find((l) => l.key === lengthKey)?.seconds ?? 300;

  const { data: status } = useQuery<{ activeProvider: string; hasReplicateKey: boolean; aceStepReady: boolean; musicGenReady: boolean; lyricsProvider: string }>({
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
        body: JSON.stringify({ prompt, lyrics: lyrics.trim() || undefined, durationSeconds: duration }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Generation failed");
      return data as { url: string; provider: string; hasVocals: boolean; objectPath: string };
    },
    onSuccess: (data) => { setResult(data); toast({ title: "Song generated", description: `Provider: ${data.provider}` }); },
    onError: (err: Error) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const genLyrics = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/music/lyrics", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme, genre: prompt.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lyric generation failed");
      return data as { lyrics: string; source: string };
    },
    onSuccess: (data) => { setLyrics(data.lyrics); toast({ title: "Lyrics generated", description: `Source: ${data.source}` }); },
    onError: (err: Error) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const isSim = status?.activeProvider === "simulation";

  return (
    <Card className="bg-card/50 border-card-border">
      <CardHeader className="pb-4">
        <div className="flex items-center gap-2">
          <Music2 className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">AI Song Generator</CardTitle>
          <Badge variant="outline" className="text-[10px]">Beta · Admin only</Badge>
        </div>
        <CardDescription>
          Generate a song with an open, commercially-licensed model. Not exposed in the product yet.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className={`rounded-lg border px-3 py-2 text-xs ${isSim ? "border-amber-500/30 bg-amber-500/10 text-amber-300" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"}`}>
          {isSim ? (
            <>Running in <b>simulation mode</b> (placeholder audio). Set <code>REPLICATE_API_TOKEN</code> to enable real <b>instrumental</b> generation (MusicGen). Add <code>MUSIC_ACESTEP_MODEL</code> for vocal songs.</>
          ) : (
            <>Live provider: <b>{status?.activeProvider}</b> {status?.aceStepReady ? "· ACE-Step (vocals) ready" : ""} {status?.musicGenReady ? "· MusicGen (instrumental) ready" : ""}</>
          )}
        </div>

        <div>
          <label className="text-sm font-medium">Style / genre prompt</label>
          <Input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="relaxing lofi hip hop, mellow mechanical textures, 72 BPM, vinyl crackle" className="mt-1" data-testid="admin-music-prompt" />
        </div>

        {/* Lyrics + AI generation */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-sm font-medium">Lyrics <span className="text-muted-foreground font-normal">(optional — vocal models; blank = instrumental)</span></label>
            <div className="flex items-center gap-2">
              <Input
                value={theme}
                onChange={(e) => setTheme(e.target.value)}
                placeholder="theme, e.g. late-night city drive"
                className="h-8 w-56 text-xs"
                data-testid="admin-lyrics-theme"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => genLyrics.mutate()}
                disabled={genLyrics.isPending || theme.trim().length < 2}
                data-testid="admin-generate-lyrics"
              >
                {genLyrics.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><Sparkles className="mr-1.5 h-3.5 w-3.5" /> Write lyrics</>}
              </Button>
            </div>
          </div>
          <Textarea value={lyrics} onChange={(e) => setLyrics(e.target.value)} placeholder="Enter a theme above and click Write lyrics, or paste your own. [Verse] / [Chorus] tags recommended." className="mt-1 min-h-[140px]" maxLength={5000} data-testid="admin-music-lyrics" />
          {status?.lyricsProvider === "template" && (
            <p className="mt-1 text-[11px] text-amber-400/80">Lyrics use a built-in template. Set ANTHROPIC_API_KEY or OPENAI_API_KEY for AI-written lyrics.</p>
          )}
        </div>

        <div className="flex items-center gap-3">
          <label className="text-sm font-medium">Length</label>
          <select value={lengthKey} onChange={(e) => setLengthKey(e.target.value)} className="rounded-md border border-input bg-background px-3 py-1.5 text-sm" data-testid="admin-music-length">
            {LENGTH_OPTIONS.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
          </select>
          <Button onClick={() => gen.mutate()} disabled={gen.isPending || prompt.trim().length < 3} className="ml-auto bg-gradient-electric text-white shadow-glow">
            {gen.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating…</> : <><Sparkles className="mr-2 h-4 w-4" /> Generate song</>}
          </Button>
        </div>

        {result && (
          <div className="rounded-lg border border-border bg-background/40 p-4 space-y-2">
            <div className="text-sm font-semibold flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              Generated · {result.provider} {result.hasVocals ? "· with vocals" : "· instrumental"}
            </div>
            <audio src={result.url} controls className="w-full" />
            <p className="text-xs text-muted-foreground break-all">
              objectPath: <code>{result.objectPath}</code>
            </p>
            {(() => {
              const title = prompt.trim().split(/\s+/).slice(0, 4).join(" ") || "AI Song";
              return (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Button
                    size="sm"
                    onClick={() => navigate(`/editor?audio=${encodeURIComponent(result.url)}&title=${encodeURIComponent(title)}`)}
                    data-testid="song-to-remix"
                  >
                    <Scissors className="mr-1.5 h-3.5 w-3.5" /> Make a Remix video
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => navigate(`/generate?audioObjectPath=${encodeURIComponent(result.objectPath)}&title=${encodeURIComponent(title)}`)}
                    data-testid="song-to-generate"
                  >
                    <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Generate a video
                  </Button>
                  <a href={result.url} download className="text-xs text-primary hover:underline ml-1">Download</a>
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
type Tab = "users" | "support" | "jobs" | "deleted" | "music";

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
          Music
          <span className="ml-1 px-1.5 py-0.5 rounded-full bg-primary/20 text-primary text-[10px] font-mono leading-none">Beta</span>
        </button>
      </div>

      {tab === "music" && <AdminMusicPanel />}

      {/* ── Users tab ── */}
      {tab === "users" && (
        <Card className="bg-card/50 border-card-border">
          <CardHeader className="pb-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <CardTitle className="text-lg">Users</CardTitle>
                <CardDescription>
                  {users ? `${users.length} user${users.length !== 1 ? "s" : ""}${debouncedSearch ? " matching" : ""}` : "Loading…"}
                </CardDescription>
              </div>
              <div className="relative w-full sm:w-72">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  className="pl-9"
                  placeholder="Search by email or name…"
                  value={search}
                  onChange={handleSearchChange}
                />
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
