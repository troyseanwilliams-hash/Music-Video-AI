import { useEffect } from "react";
import { Link } from "wouter";
import { ArrowRight, Check, ChevronRight, Film, Music2, Sparkles, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";

const rows = [
  {
    label: "What you start with",
    ours: "A prompt, a vibe, or a song you already love",
    other: "A library of pre-made clips to sort through",
  },
  {
    label: "The music",
    ours: "We write a full vocal song or an original instrumental from your idea",
    other: "You bring the finished track or choose one separately",
  },
  {
    label: "The footage",
    ours: "Fresh AI-generated scenes directed around your song",
    other: "Stock footage that was made before your project",
  },
  {
    label: "How it matches",
    ours: "The engine reads the beat, energy, and structure, then times scenes to the music",
    other: "Manual cuts, templates, or basic beat timing",
  },
  {
    label: "How unique it feels",
    ours: "A new song and visual direction for every idea",
    other: "The same library clips can appear in many edits",
  },
  {
    label: "What you leave with",
    ours: "Your song, full video, vertical cuts, and Spotify Canvas loop",
    other: "An edit assembled from clips you selected",
  },
];

const workflow = [
  {
    icon: Music2,
    title: "Write the music",
    body: "Describe a mood, genre, or story. Soundtracks creates a full vocal song or instrumental you can keep as audio.",
  },
  {
    icon: Wand2,
    title: "Create the footage",
    body: "Give the song a look. AIBeatSync builds original scenes and keeps the visual rhythm connected to the track.",
  },
  {
    icon: Film,
    title: "Release the whole idea",
    body: "Get the full video plus social cuts and a Canvas loop—without stitching together separate tools.",
  },
];

export default function Comparison() {
  useEffect(() => {
    const previousTitle = document.title;
    const meta = document.querySelector('meta[name="description"]');
    const previousDescription = meta?.getAttribute("content") ?? null;
    document.title = "Why AIBeatSync Is Different — Music, Footage, and Video in One Studio";
    meta?.setAttribute(
      "content",
      "AIBeatSync writes original songs and creates original beat-synced footage in one studio. Compare the workflow with clip-first video tools.",
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
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/35 bg-primary/10 px-3.5 py-1.5 text-xs font-medium text-primary">
          <Sparkles className="h-3.5 w-3.5" />
          A music studio that creates the footage too
        </div>
        <h1 className="mx-auto max-w-4xl text-4xl font-extrabold leading-[1.07] tracking-tight sm:text-5xl lg:text-6xl">
          We write your music, then{" "}
          <span className="text-gradient-electric">make the video.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
          Most clip-first tools start with footage. AIBeatSync starts with your idea: create a full vocal song or
          instrumental from a prompt, generate original visuals around it, and leave with music you can use in a video
          or enjoy on its own.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button asChild size="lg" className="h-11 bg-gradient-electric px-5 text-sm text-white shadow-glow">
            <Link href="/generate">
              Create my music video <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="h-11 px-5 text-sm">
            <Link href="/pricing">See pricing</Link>
          </Button>
        </div>
      </section>

      <section className="relative z-10 mx-auto max-w-6xl px-4 pb-20 sm:px-6 lg:px-10">
        <div className="overflow-x-auto rounded-2xl border border-border/80 bg-black/20 shadow-2xl shadow-violet-950/20">
          <div className="min-w-[720px]">
            <div className="grid grid-cols-[0.7fr_1.35fr_1fr] border-b border-border/80 bg-white/[0.025] text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground sm:text-xs">
              <div className="p-4 sm:p-6">Capability</div>
              <div className="border-l border-border/80 p-4 text-primary sm:p-6">AIBeatSync</div>
              <div className="border-l border-border/80 p-4 sm:p-6">Clip-first tools</div>
            </div>
            {rows.map((row) => (
              <div key={row.label} className="grid grid-cols-[0.7fr_1.35fr_1fr] border-b border-border/70 last:border-b-0">
                <div className="p-4 text-xs font-semibold leading-5 text-foreground sm:p-6 sm:text-sm">{row.label}</div>
                <div className="flex gap-2 border-l border-border/70 p-4 text-xs leading-5 text-foreground/90 sm:p-6 sm:text-sm">
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary sm:h-4 sm:w-4" />
                  <span>{row.ours}</span>
                </div>
                <div className="border-l border-border/70 p-4 text-xs leading-5 text-muted-foreground sm:p-6 sm:text-sm">{row.other}</div>
              </div>
            ))}
          </div>
        </div>
        <p className="mt-3 text-center text-xs text-muted-foreground sm:hidden">
          Swipe left to compare all capabilities
        </p>
        <p className="mx-auto mt-4 max-w-3xl text-center text-[11px] leading-5 text-muted-foreground">
          The difference is the starting point: AIBeatSync creates the song and the footage as one connected idea,
          instead of asking you to find finished music and hunt through clips first.
        </p>
      </section>

      <section className="border-y border-border/30 bg-blue-950/20">
        <div className="mx-auto max-w-5xl px-4 py-20 sm:px-6 lg:px-10">
          <div className="mx-auto mb-10 max-w-2xl text-center">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-primary">One creative loop</p>
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              The tool creates the <span className="text-gradient-electric">footage</span> and the soundtrack.
            </h2>
            <p className="mt-4 text-sm leading-6 text-muted-foreground sm:text-base">
              You can start with a song, or start with an idea. Either way, the music and video are built to belong
              together.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {workflow.map((item, index) => (
              <article key={item.title} className="rounded-2xl border border-border/80 bg-card/70 p-6">
                <div className="mb-5 flex items-center justify-between">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-primary">
                    <item.icon className="h-5 w-5" />
                  </span>
                  <span className="text-xs font-semibold text-muted-foreground">0{index + 1}</span>
                </div>
                <h3 className="text-base font-semibold">{item.title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-4 py-20 text-center sm:px-6 lg:px-10">
        <div className="rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/10 via-transparent to-blue-500/10 p-7 sm:p-10">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Music2 className="h-5 w-5" />
          </div>
          <h2 className="mt-5 text-2xl font-bold tracking-tight sm:text-3xl">Use the music your way.</h2>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-muted-foreground sm:text-base">
            Make a song for a video, or make a song just because you want one. Your Soundtracks library keeps the
            audio ready to download, share, and reuse whenever inspiration hits.
          </p>
          <Button asChild variant="link" className="mt-5 h-auto p-0 text-sm font-semibold text-primary">
            <Link href="/soundtracks">
              Explore Soundtracks <ChevronRight className="ml-1 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </section>
    </div>
  );
}