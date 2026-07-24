import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Sparkles, Music2, Film, FileText, Copy, Check, Loader2, ArrowRight, Wand2,
} from "lucide-react";

type AudioResult = { prompt: string; genre: string; mood: string; bpm: number | null; tags: string[]; source: string };
type VideoResult = { prompt: string; negativePrompt: string; source: string };
type LyricsResult = { lyrics: string; source: string };

async function postJSON<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? <Check className="mr-1.5 h-3.5 w-3.5" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}
      {copied ? "Copied" : label}
    </Button>
  );
}

export default function PromptStudio() {
  const { user, isAuthenticated, isLoading } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  // Audio tab
  const [audioDesc, setAudioDesc] = useState("");
  const [audioBusy, setAudioBusy] = useState(false);
  const [audioRes, setAudioRes] = useState<AudioResult | null>(null);

  // Video tab
  const [videoDesc, setVideoDesc] = useState("");
  const [videoStyle, setVideoStyle] = useState("");
  const [videoBusy, setVideoBusy] = useState(false);
  const [videoRes, setVideoRes] = useState<VideoResult | null>(null);

  // Lyrics tab
  const [theme, setTheme] = useState("");
  const [genre, setGenre] = useState("");
  const [mood, setMood] = useState("");
  const [lyricsBusy, setLyricsBusy] = useState(false);
  const [lyricsRes, setLyricsRes] = useState<LyricsResult | null>(null);

  const fail = (err: unknown) =>
    toast({ title: "Couldn't build that", description: err instanceof Error ? err.message : "Try again", variant: "destructive" });

  async function buildAudio() {
    if (audioDesc.trim().length < 2) return;
    setAudioBusy(true);
    try {
      setAudioRes(await postJSON<AudioResult>("/api/prompt/audio", { description: audioDesc }));
    } catch (err) { fail(err); } finally { setAudioBusy(false); }
  }
  async function buildVideo() {
    if (videoDesc.trim().length < 2) return;
    setVideoBusy(true);
    try {
      setVideoRes(await postJSON<VideoResult>("/api/prompt/video", { description: videoDesc, style: videoStyle || undefined }));
    } catch (err) { fail(err); } finally { setVideoBusy(false); }
  }
  async function buildLyrics() {
    if (theme.trim().length < 2) return;
    setLyricsBusy(true);
    try {
      setLyricsRes(await postJSON<LyricsResult>("/api/prompt/lyrics", { theme, genre: genre || undefined, mood: mood || undefined }));
    } catch (err) { fail(err); } finally { setLyricsBusy(false); }
  }

  if (isLoading) {
    return <div className="min-h-[60vh] flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }
  if (!isAuthenticated) {
    return (
      <div className="container mx-auto px-4 py-20 max-w-md text-center">
        <Sparkles className="mx-auto h-10 w-10 text-primary mb-4" />
        <h1 className="text-2xl font-bold mb-2">Prompt Studio</h1>
        <p className="text-muted-foreground mb-6">Sign in to build polished prompts for your videos and soundtracks.</p>
        <Link href="/login"><Button size="lg" className="bg-gradient-electric text-white border-0">Sign in</Button></Link>
      </div>
    );
  }
  // Admin-only preview for now.
  if (!user?.isAdmin) {
    return (
      <div className="container mx-auto px-4 py-20 max-w-md text-center">
        <Sparkles className="mx-auto h-10 w-10 text-primary mb-4" />
        <h1 className="text-2xl font-bold mb-2">Prompt Studio</h1>
        <p className="text-muted-foreground">This feature is in limited preview and isn't available on your account yet. Check back soon.</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 sm:py-12 max-w-3xl">
      <div className="mb-8 text-center">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-electric shadow-glow mb-3">
          <Sparkles className="h-6 w-6 text-white" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Prompt Studio</h1>
        <p className="text-muted-foreground mt-2">
          Describe what you want in plain words — we'll turn it into a ready-to-use prompt. Free for members.
        </p>
      </div>

      <Tabs defaultValue="audio" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="audio"><Music2 className="mr-1.5 h-4 w-4" /> Soundtrack</TabsTrigger>
          <TabsTrigger value="video"><Film className="mr-1.5 h-4 w-4" /> Video</TabsTrigger>
          <TabsTrigger value="lyrics"><FileText className="mr-1.5 h-4 w-4" /> Lyrics</TabsTrigger>
        </TabsList>

        {/* Audio */}
        <TabsContent value="audio" className="space-y-4 pt-4">
          <label className="text-sm font-medium">Describe the vibe</label>
          <Textarea
            value={audioDesc}
            onChange={(e) => setAudioDesc(e.target.value)}
            placeholder="e.g. dreamy lofi beat for a rainy night study session, mellow and nostalgic"
            className="min-h-[90px]"
          />
          <Button onClick={buildAudio} disabled={audioBusy || audioDesc.trim().length < 2} className="bg-gradient-electric text-white border-0">
            {audioBusy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Building…</> : <><Wand2 className="mr-2 h-4 w-4" /> Build music prompt</>}
          </Button>

          {audioRes && (
            <div className="rounded-xl border border-border/60 bg-secondary/30 p-4 space-y-3">
              <p className="text-sm leading-relaxed">{audioRes.prompt}</p>
              <div className="flex flex-wrap gap-1.5 text-xs">
                {audioRes.genre && <span className="rounded-full bg-primary/15 border border-primary/20 px-2 py-0.5">{audioRes.genre}</span>}
                {audioRes.mood && <span className="rounded-full bg-primary/15 border border-primary/20 px-2 py-0.5">{audioRes.mood}</span>}
                {audioRes.bpm && <span className="rounded-full bg-primary/15 border border-primary/20 px-2 py-0.5">{audioRes.bpm} BPM</span>}
                {audioRes.tags.map((t) => <span key={t} className="rounded-full bg-secondary px-2 py-0.5 text-muted-foreground">{t}</span>)}
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                <CopyButton text={audioRes.prompt} />
                <Button size="sm" onClick={() => setLocation(`/soundtracks?prompt=${encodeURIComponent(audioRes.prompt)}`)}>
                  Use in Soundtracks <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </TabsContent>

        {/* Video */}
        <TabsContent value="video" className="space-y-4 pt-4">
          <label className="text-sm font-medium">Describe the scene</label>
          <Textarea
            value={videoDesc}
            onChange={(e) => setVideoDesc(e.target.value)}
            placeholder="e.g. a lone astronaut discovering a glowing forest on an alien planet at dusk"
            className="min-h-[90px]"
          />
          <Input value={videoStyle} onChange={(e) => setVideoStyle(e.target.value)} placeholder="Optional style — cinematic, anime, neon, vintage…" className="max-w-xs" />
          <div>
            <Button onClick={buildVideo} disabled={videoBusy || videoDesc.trim().length < 2} className="bg-gradient-electric text-white border-0">
              {videoBusy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Building…</> : <><Wand2 className="mr-2 h-4 w-4" /> Build video prompt</>}
            </Button>
          </div>

          {videoRes && (
            <div className="rounded-xl border border-border/60 bg-secondary/30 p-4 space-y-3">
              <p className="text-sm leading-relaxed">{videoRes.prompt}</p>
              {videoRes.negativePrompt && (
                <p className="text-xs text-muted-foreground"><span className="font-medium">Avoid:</span> {videoRes.negativePrompt}</p>
              )}
              <div className="flex flex-wrap gap-2 pt-1">
                <CopyButton text={videoRes.prompt} />
                <Button size="sm" onClick={() => setLocation(`/generate?prompt=${encodeURIComponent(videoRes.prompt)}`)}>
                  Use in Generate <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </TabsContent>

        {/* Lyrics */}
        <TabsContent value="lyrics" className="space-y-4 pt-4">
          <label className="text-sm font-medium">What's the song about?</label>
          <Textarea
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            placeholder="e.g. chasing a dream across a city that never sleeps"
            className="min-h-[80px]"
          />
          <div className="flex flex-wrap gap-2">
            <Input value={genre} onChange={(e) => setGenre(e.target.value)} placeholder="Genre (optional)" className="max-w-[180px]" />
            <Input value={mood} onChange={(e) => setMood(e.target.value)} placeholder="Mood (optional)" className="max-w-[180px]" />
          </div>
          <Button onClick={buildLyrics} disabled={lyricsBusy || theme.trim().length < 2} className="bg-gradient-electric text-white border-0">
            {lyricsBusy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Writing…</> : <><Wand2 className="mr-2 h-4 w-4" /> Write lyrics</>}
          </Button>

          {lyricsRes && (
            <div className="rounded-xl border border-border/60 bg-secondary/30 p-4 space-y-3">
              <pre className="text-sm leading-relaxed whitespace-pre-wrap font-sans">{lyricsRes.lyrics}</pre>
              <CopyButton text={lyricsRes.lyrics} label="Copy lyrics" />
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
