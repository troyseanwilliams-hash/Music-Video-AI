import { useEffect, useState } from "react";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Music2, Wand2, Clapperboard, Mic2, ArrowRight, Sparkles } from "lucide-react";
import { motion } from "framer-motion";
import { AuroraBackground } from "@/components/AuroraBackground";

const SUNO_URL_RE = /suno\.(?:com|ai)\/song\/[a-f0-9-]{36}/i;

/**
 * SEO landing page: "Turn your Suno song into a music video."
 * Public (no auth) — captures the pasted link, stashes it so it survives
 * login/register, and deep-links into the generator via /generate?suno=.
 */
export default function SunoLanding() {
  const { isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Suno to Music Video — AI Beat Sync";
    const meta = document.querySelector('meta[name="description"]');
    const prev = meta?.getAttribute("content") ?? null;
    meta?.setAttribute(
      "content",
      "Paste your Suno song link and get an AI-generated, beat-synced music video with karaoke lyrics. Free to try — no upload needed.",
    );
    return () => {
      document.title = "AI Beat Sync";
      if (prev && meta) meta.setAttribute("content", prev);
    };
  }, []);

  function handleGo() {
    const trimmed = url.trim();
    if (!SUNO_URL_RE.test(trimmed)) {
      setError("That doesn't look like a Suno song link — it should look like suno.com/song/…");
      return;
    }
    setError(null);
    // Survives the login/register detour for logged-out visitors.
    localStorage.setItem("pendingSunoUrl", trimmed);
    if (isAuthenticated) {
      setLocation(`/generate?suno=${encodeURIComponent(trimmed)}`);
    } else {
      setLocation("/register");
    }
  }

  const steps = [
    {
      icon: Music2,
      title: "Paste your Suno link",
      body: "Any public Suno song works — we pull the audio straight from Suno, no download or re-upload needed.",
    },
    {
      icon: Wand2,
      title: "Pick a style",
      body: "Cinematic, anime, neon, abstract and more. We analyze the BPM, energy and structure of your track to drive the visuals.",
    },
    {
      icon: Clapperboard,
      title: "Get your video",
      body: "A beat-synced AI music video, ready for YouTube, TikTok or Spotify Canvas — with optional karaoke-style lyrics.",
    },
  ];

  return (
    <div className="relative overflow-hidden">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[700px] bg-primary/8 rounded-full blur-[160px] pointer-events-none" />
      <AuroraBackground className="opacity-60" />

      {/* Hero */}
      <section className="container mx-auto px-6 pt-20 pb-16 max-w-3xl text-center relative z-10">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary mb-6">
            <Sparkles className="h-3.5 w-3.5" />
            Made a song on Suno? Give it a video.
          </div>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">
            Turn your <span className="bg-gradient-electric bg-clip-text text-transparent">Suno song</span> into a music video
          </h1>
          <p className="text-muted-foreground text-lg mb-8">
            Paste a Suno link, pick a style, and get an AI-generated video cut to your beat —
            with karaoke lyrics that fill in as they're sung.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 max-w-xl mx-auto">
            <Input
              placeholder="https://suno.com/song/…"
              value={url}
              onChange={(e) => { setUrl(e.target.value); setError(null); }}
              onKeyDown={(e) => e.key === "Enter" && handleGo()}
              className="h-12 text-base"
              data-testid="input-suno-landing-url"
            />
            <Button
              size="lg"
              onClick={handleGo}
              className="h-12 px-6 bg-gradient-electric text-white shadow-glow shrink-0"
              data-testid="button-suno-landing-go"
            >
              Make my video
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
          {error && <p className="text-sm text-destructive mt-3">{error}</p>}
          <p className="text-xs text-muted-foreground mt-4">
            Free to try — new accounts start with trial credits. Your song must be public on Suno.
          </p>
        </motion.div>
      </section>

      {/* Steps */}
      <section className="container mx-auto px-6 pb-16 max-w-4xl relative z-10">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {steps.map((s, i) => (
            <div key={s.title} className="rounded-xl border border-border bg-card/40 p-6">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-electric shadow-glow mb-4">
                <s.icon className="h-5 w-5 text-white" />
              </div>
              <div className="text-xs font-medium text-muted-foreground mb-1">Step {i + 1}</div>
              <h3 className="font-semibold mb-2">{s.title}</h3>
              <p className="text-sm text-muted-foreground">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Karaoke callout */}
      <section className="container mx-auto px-6 pb-20 max-w-3xl relative z-10">
        <div className="rounded-xl border border-primary/25 bg-primary/5 p-6 flex items-start gap-4">
          <Mic2 className="h-6 w-6 text-primary shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold mb-1">Karaoke lyric sync, built in</h3>
            <p className="text-sm text-muted-foreground">
              Paste your Suno lyrics and every word fills in on-screen as it's sung. Got an .lrc
              file with timestamps? We'll sync to it exactly.
            </p>
          </div>
        </div>
        <div className="text-center mt-10">
          <Link href="/explore">
            <Button variant="outline">See videos others have made</Button>
          </Link>
        </div>
      </section>
    </div>
  );
}
