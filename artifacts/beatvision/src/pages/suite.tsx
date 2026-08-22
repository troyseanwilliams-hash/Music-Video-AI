import { Mic, Video, Sparkles, Gift, Coins, Zap, ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useSEO } from "@/hooks/useSEO";

const POD_FEATURES = [
  "10 studio-quality AI narrator voices",
  "Automatic mixing & mastering",
  "Turn any episode into TikTok/Reels/Shorts clips with burned-in captions",
  "AI-suggested highlight moments, show notes & SEO metadata",
];

const BEAT_FEATURES = [
  "Beat-synced AI visuals with consistent characters",
  "Royalty-free AI soundtrack & lyric generation",
  "Remix Lab for full manual control over your cut",
  "720p to 4K Ultra rendering, plus TikTok & Spotify Canvas exports",
];

const VALUES = [
  {
    icon: Zap,
    title: "Try before you pay",
    body: "Both apps give you a free 7-day trial with no credit card required, so you can judge the output before spending anything.",
  },
  {
    icon: Coins,
    title: "Credits in both studios",
    body: "Subscribe to both studios and each gets its own credit balance, so podcast work never takes away from video credits.",
  },
  {
    icon: Gift,
    title: "Refer & earn on both",
    body: "Share your link on either app and you and your friend both earn bonus credits when they sign up.",
  },
];

export default function Suite() {
  useSEO({
    title: "AISync Suite — AIPodSync + AIBeatSync",
    description:
      "The AISync Suite: AIPodSync turns a script into a professional podcast, and AIBeatSync turns a song into a ready-to-post music video.",
    canonical: "/suite",
  });

  return (
    <div className="container mx-auto px-4 py-16 max-w-5xl">
      <div className="text-center max-w-2xl mx-auto mb-16">
        <Badge className="mb-6 border-primary/30 bg-primary/10 text-primary">
          <Sparkles className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
          The AISync Suite
        </Badge>
        <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight mb-6 leading-tight">
          Turn songs into a video.
          <br />
          <span className="text-gradient-electric">Turn words into a podcast.</span>
        </h1>
        <p className="text-lg text-muted-foreground">
          The AISync Suite is home to two focused AI studios — AIBeatSync for beat-synced AI music videos, and
          AIPodSync for narrated podcasts and audiogram clips. Different craft, same simple idea: describe what
          you want, and AI does the production work.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-20">
        <Card className="p-8 border-primary/20">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-electric shadow-glow mb-5">
            <Video className="h-5 w-5 text-white" aria-hidden="true" />
          </span>
          <h2 className="text-2xl font-bold mb-1">AIBeatSync</h2>
          <p className="text-sm font-semibold text-primary mb-4">From a track to a ready-to-post video.</p>
          <p className="text-sm text-muted-foreground mb-6">
            Most tools stop at a single clip. AIBeatSync takes you the whole way — beat-synced AI visuals,
            consistent characters, a royalty-free soundtrack, and one-click social cuts. Bring a song or generate
            one, then let AI direct it or take control in Remix Lab.
          </p>
          <ul className="space-y-2 mb-6">
            {BEAT_FEATURES.map((f) => (
              <li key={f} className="flex items-start gap-2 text-sm">
                <span className="text-primary font-bold" aria-hidden="true">
                  ✓
                </span>
                {f}
              </li>
            ))}
          </ul>
          <a href="/editor">
            <Button className="w-full bg-gradient-electric text-white shadow-glow border-0">
              Open Remix Lab
              <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
            </Button>
          </a>
          <p className="text-xs text-center text-muted-foreground mt-3">
            Free 7-day trial with unlimited Remix Lab exports · no card required
          </p>
        </Card>

        <Card className="p-8 border-accent/20">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-[#22d3c9] to-[#7c6bf5] mb-5">
            <Mic className="h-5 w-5 text-white" aria-hidden="true" />
          </span>
          <h2 className="text-2xl font-bold mb-1">AIPodSync</h2>
          <p className="text-sm font-semibold text-accent mb-4">Write a script. Get a professional podcast.</p>
          <p className="text-sm text-muted-foreground mb-6">
            No mic, no editing, no experience needed. Write or paste a script, pick from 10 AI narrator voices,
            add a background music bed — AIPodSync narrates, mixes, and masters a polished, publish-ready episode
            in minutes. Already have an episode recorded? Cut it into share-ready clips instead.
          </p>
          <ul className="space-y-2 mb-6">
            {POD_FEATURES.map((f) => (
              <li key={f} className="flex items-start gap-2 text-sm">
                <span className="text-accent font-bold" aria-hidden="true">
                  ✓
                </span>
                {f}
              </li>
            ))}
          </ul>
          <a href="https://aipodsync.com" target="_blank" rel="noopener noreferrer">
            <Button className="w-full bg-gradient-to-r from-[#22d3c9] to-[#7c6bf5] text-white border-0">
              Start your episode
              <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
            </Button>
          </a>
          <p className="text-xs text-center text-muted-foreground mt-3">
            25 free credits to start · free 7-day trial, no card required
          </p>
        </Card>
      </div>

        <section className="mb-20 rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 via-card/70 to-accent/10 p-6 sm:p-8">
          <div className="mx-auto max-w-3xl text-center">
            <Badge className="mb-4 border-primary/30 bg-primary/10 text-primary">
              <Coins className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
              Suite subscription strategy
            </Badge>
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Subscribe to both. Get credits in both studios.
            </h2>
            <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
              Keep each subscription focused on the work it powers. When you subscribe to AIBeatSync and AIPodSync,
              each app receives its own renewable credits—so your podcast credits never compete with your video
              credits.
            </p>
          </div>
          <ol className="mx-auto mt-7 grid max-w-3xl gap-3 sm:grid-cols-3">
            {[
              "Choose an AIBeatSync plan for music videos and Soundtracks.",
              "Add AIPodSync when you are ready to produce narrated shows.",
              "Use each app's credits inside that studio—two balances, no trade-offs.",
            ].map((step, index) => (
              <li key={step} className="flex gap-3 rounded-xl border border-border/60 bg-background/50 p-4 text-sm text-muted-foreground">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">
                  {index + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a href="/pricing">
              <Button className="w-full bg-gradient-electric text-white shadow-glow sm:w-auto">
                Choose AIBeatSync plan
                <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
              </Button>
            </a>
            <a href="https://aipodsync.com" target="_blank" rel="noopener noreferrer">
              <Button variant="outline" className="w-full sm:w-auto">
                Explore AIPodSync
              </Button>
            </a>
          </div>
          <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
            <Check className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
            Two subscriptions today; clear, independent credits in each app.
          </p>
        </section>

      <div className="text-center max-w-xl mx-auto mb-10">
        <h2 className="text-2xl font-bold mb-2">Why one suite</h2>
        <p className="text-sm text-muted-foreground">
          AIBeatSync and AIPodSync are built and run the same way — simple credit-based pricing, no bait-and-switch
          trials, and a habit of shipping the feature you actually asked for.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {VALUES.map((v) => (
          <Card key={v.title} className="p-6">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 mb-4">
              <v.icon className="h-5 w-5 text-primary" aria-hidden="true" />
            </span>
            <h3 className="font-semibold mb-1.5">{v.title}</h3>
            <p className="text-sm text-muted-foreground">{v.body}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
