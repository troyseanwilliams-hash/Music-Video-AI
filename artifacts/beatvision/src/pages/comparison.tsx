import { useEffect } from "react";
import { Link } from "wouter";
import {
  ArrowRight,
  Check,
  ChevronRight,
  Film,
  ImagePlus,
  Layers,
  Mic,
  Music2,
  Scissors,
  Sparkles,
  Video,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const rows = [
  {
    label: "Audio Creation",
    beat: "Create or upload music; full vocal songs and instrumentals",
    pod: "Script or recording to narrated, mixed episodes",
    other: "Bring your own finished tracks and voiceovers",
  },
  {
    label: "Visual Generation",
    beat: "Original generated scenes & Narrative Story mode",
    pod: "Auto-captioned episodes & clip highlights",
    other: "Stock footage libraries and template layouts",
  },
  {
    label: "Image Assets",
    beat: "Reusable generated image packs with reference-image consistency; personal Gallery for full-resolution downloads",
    pod: "Focused on narrated episodes rather than reusable image packs",
    other: "Requires a separate image generation subscription",
  },
  {
    label: "Editor & Sync",
    beat: "Beat/energy/structure analysis; Montage Studio for ordered photos/clips, narration timing, music sync, transitions, and live preview",
    pod: "Narration, audio mixing, and auto-captioned episode workflows",
    other: "Manual cutting, separate timeline tools, or rigid beat-matching",
  },
  {
    label: "Final Exports",
    beat: "1080p no-watermark exports, social cuts, and Spotify Canvas",
    pod: "Narrated, auto-captioned episodes and clip highlights",
    other: "Often requires paid upgrades for 1080p or removing watermarks",
  },
  {
    label: "Subscription Model",
    beat: "Included in the AISync Suite",
    pod: "Included in the AISync Suite",
    other: "Multiple separate subscriptions to piece it all together",
  },
];

export default function Comparison() {
  useEffect(() => {
    const previousTitle = document.title;
    const meta = document.querySelector('meta[name="description"]');
    const previousDescription = meta?.getAttribute("content") ?? null;
    document.title = "Compare AIBeatSync, AIPodSync & The AISync Suite";
    meta?.setAttribute(
      "content",
      "See how AIBeatSync and AIPodSync provide a complete path from sound to publishable content under one AISync Suite subscription.",
    );
    return () => {
      document.title = previousTitle;
      if (meta && previousDescription) meta.setAttribute("content", previousDescription);
    };
  }, []);

  return (
    <div className="relative overflow-hidden">
      <div className="pointer-events-none absolute left-1/2 top-0 h-[700px] w-[700px] -translate-x-1/2 rounded-full bg-primary/10 blur-[160px]" />

      <section className="relative z-10 mx-auto max-w-5xl px-4 pb-14 pt-16 text-center sm:px-6 lg:pt-20">
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/35 bg-primary/10 px-3.5 py-1.5 text-xs font-medium text-primary backdrop-blur-sm">
          <Sparkles className="h-3.5 w-3.5" />
          The complete creator suite
        </div>
        <h1 className="mx-auto max-w-4xl text-4xl font-extrabold leading-[1.07] tracking-tight sm:text-5xl lg:text-6xl">
          From sound to publishable content in{" "}
          <span className="text-gradient-electric">one suite.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
          AIBeatSync handles music-first visual creation, while AIPodSync powers narration and podcast workflows.
          Together, they replace a piecemeal creative workflow.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button asChild size="lg" className="h-11 bg-gradient-electric px-5 text-sm text-white shadow-glow border-0 hover:opacity-90">
            <a href="https://aisyncsuite.com" target="_blank" rel="noopener noreferrer">
              Explore the AISync Suite <ArrowRight className="ml-2 h-4 w-4" />
            </a>
          </Button>
          <Button asChild size="lg" variant="outline" className="h-11 px-5 text-sm">
            <Link href="/pricing">See AIBeatSync pricing</Link>
          </Button>
        </div>
      </section>

      <section className="relative z-10 mx-auto max-w-6xl px-4 pb-20 sm:px-6 lg:px-10">
        <div className="overflow-x-auto rounded-2xl border border-border/80 bg-black/20 shadow-2xl shadow-violet-950/20">
          <div className="min-w-[960px]">
            <div className="grid grid-cols-[0.8fr_1.3fr_1.3fr_1fr] border-b border-border/80 bg-white/[0.025] text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground sm:text-xs">
              <div className="p-4 sm:p-6">Capability</div>
              <div className="border-l border-border/80 p-4 text-primary sm:p-6 flex items-center gap-2">
                <Video className="w-4 h-4" /> AIBeatSync
              </div>
              <div className="border-l border-border/80 p-4 text-accent sm:p-6 flex items-center gap-2">
                <Mic className="w-4 h-4" /> AIPodSync
              </div>
              <div className="border-l border-border/80 p-4 sm:p-6">Clip-first tools</div>
            </div>
            {rows.map((row) => (
              <div key={row.label} className="grid grid-cols-[0.8fr_1.3fr_1.3fr_1fr] border-b border-border/70 last:border-b-0">
                <div className="p-4 text-xs font-semibold leading-5 text-foreground sm:p-6 sm:text-sm">{row.label}</div>
                <div className="border-l border-border/70 p-4 text-xs leading-5 text-foreground/90 sm:p-6 sm:text-sm bg-primary/[0.02]">
                  {row.beat !== "—" ? (
                    <span className="flex gap-2">
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary sm:h-4 sm:w-4" />
                      <span>{row.beat}</span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </div>
                <div className="border-l border-border/70 p-4 text-xs leading-5 text-foreground/90 sm:p-6 sm:text-sm bg-accent/[0.02]">
                  {row.pod !== "—" ? (
                    <span className="flex gap-2">
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent sm:h-4 sm:w-4" />
                      <span>{row.pod}</span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </div>
                <div className="border-l border-border/70 p-4 text-xs leading-5 text-muted-foreground sm:p-6 sm:text-sm">{row.other}</div>
              </div>
            ))}
          </div>
        </div>
        <p className="mt-3 text-center text-xs text-muted-foreground sm:hidden">
          Swipe left to compare all capabilities
        </p>
      </section>

      <section className="border-y border-border/30 bg-gradient-to-br from-primary/5 via-transparent to-accent/5">
        <div className="mx-auto max-w-5xl px-4 py-20 sm:px-6 lg:px-10 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-card border border-border mb-6 shadow-xl">
            <Layers className="h-7 w-7 text-foreground" />
          </div>
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            One subscription. Two studios.
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
            The AISync Suite gives you dedicated, separate monthly credit balances for AIBeatSync and AIPodSync on a single bill. Your video generation credits never compete with your podcast credits.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row justify-center gap-4">
             <Button asChild variant="outline" size="lg" className="border-border/60 hover:bg-card">
                <a href="https://aipodsync.com" target="_blank" rel="noopener noreferrer">
                  Discover AIPodSync
                </a>
             </Button>
             <Button asChild size="lg" className="bg-foreground text-background hover:bg-foreground/90 border-0">
                <a href="https://aisyncsuite.com" target="_blank" rel="noopener noreferrer">
                  View Suite Pricing
                </a>
             </Button>
          </div>
        </div>
      </section>

      <section className="border-b border-border/30 bg-black/10">
        <div className="mx-auto max-w-5xl px-4 py-20 sm:px-6 lg:px-10">
          <div className="mb-12">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-primary">Music & Video</p>
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              AIBeatSync Capabilities
            </h2>
          </div>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {[
              {
                icon: Music2,
                title: "Music Generation",
                body: "Create or upload music, including full vocal songs and instrumentals.",
              },
              {
                icon: Wand2,
                title: "Original Scenes",
                body: "Generate original scenes and Narrative Story mode based on beat, energy, and structure analysis.",
              },
              {
                icon: ImagePlus,
                title: "Image Packs & Gallery",
                body: "Create reusable generated image packs with reference-image consistency. Access your personal Gallery for full-resolution downloads.",
              },
              {
                icon: Scissors,
                title: "Montage Studio",
                body: "Order photos and clips, handle narration timing and music sync, and add transitions with live preview.",
              },
              {
                icon: Film,
                title: "Premium Exports",
                body: "Export in 1080p with no watermark, generate social cuts, and create Spotify Canvas loops.",
              }
            ].map((item) => (
              <article key={item.title} className="rounded-2xl border border-border/80 bg-card/70 p-6 transition-colors hover:border-primary/40">
                <div className="mb-5 flex items-center justify-between">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 text-primary">
                    <item.icon className="h-5 w-5" />
                  </span>
                </div>
                <h3 className="text-base font-semibold">{item.title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.body}</p>
              </article>
            ))}
          </div>
          <div className="mt-10">
            <Button asChild variant="link" className="h-auto p-0 text-sm font-semibold text-primary">
              <Link href="/generate">
                Start creating in AIBeatSync <ChevronRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="bg-black/10">
        <div className="mx-auto max-w-5xl px-4 py-20 sm:px-6 lg:px-10">
          <div className="mb-12">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-accent">Podcasts & Narration</p>
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              AIPodSync Capabilities
            </h2>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            {[
              {
                icon: Mic,
                title: "Script to Episode",
                body: "Turn a script or voice recording into a narrated episode with audio mixing.",
              },
              {
                icon: Video,
                title: "Auto-captioning",
                body: "Create narrated, auto-captioned visual episodes.",
              },
              {
                icon: Sparkles,
                title: "Clip Highlights",
                body: "Create short clip highlights from podcast and narration content.",
              }
            ].map((item) => (
              <article key={item.title} className="rounded-2xl border border-border/80 bg-card/70 p-6 transition-colors hover:border-accent/40">
                <div className="mb-5 flex items-center justify-between">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent/15 text-accent">
                    <item.icon className="h-5 w-5" />
                  </span>
                </div>
                <h3 className="text-base font-semibold">{item.title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.body}</p>
              </article>
            ))}
          </div>
          <div className="mt-10">
            <Button asChild variant="link" className="h-auto p-0 text-sm font-semibold text-accent">
              <a href="https://aipodsync.com" target="_blank" rel="noopener noreferrer">
                Visit AIPodSync <ChevronRight className="ml-1 h-4 w-4" />
              </a>
            </Button>
          </div>
        </div>
      </section>

    </div>
  );
}
