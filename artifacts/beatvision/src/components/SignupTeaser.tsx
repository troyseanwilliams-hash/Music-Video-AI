import type { ComponentType, ReactNode } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Play, Sparkles, Scissors, Lock, Wand2, Music, ArrowRight } from "lucide-react";

const SAMPLES = ["/sample1.mp4", "/sample2.mp4", "/sample3.mp4"];

type Bullet = { icon: ComponentType<{ className?: string }>; text: string };
type Content = { badge: string; title: ReactNode; sub: string; bullets: Bullet[] };

const CONTENT: Record<"generate" | "remix", Content> = {
  generate: {
    badge: "AI Music Video Generator",
    title: (
      <>
        Turn any song into a <span className="text-gradient-electric">cinematic music video</span>
      </>
    ),
    sub: "Upload a track and our AI generates beat-synced visuals — your character, your style, ready to post. Create a free account to start.",
    bullets: [
      { icon: Sparkles, text: "Beat-synced AI visuals in 8 cinematic styles" },
      { icon: Lock, text: "Character Lock keeps your look consistent across every clip" },
      { icon: Play, text: "Storyboard preview before you spend a thing" },
      { icon: Wand2, text: "Up to 4K resolution and 10-minute videos" },
    ],
  },
  remix: {
    badge: "Remix Lab",
    title: (
      <>
        Build your own cut in the <span className="text-gradient-electric">Remix Lab</span>
      </>
    ),
    sub: "Drop clips and photos on a timeline, sync music, add transitions, and export a clean 1080p video — no watermark. Free to start.",
    bullets: [
      { icon: Scissors, text: "Drag-to-trim timeline for your clips & photos" },
      { icon: Music, text: "Sync a music track — loop or fade it to fit" },
      { icon: Sparkles, text: "Smooth transitions with a live preview" },
      { icon: Play, text: "Export crisp 1080p MP4, watermark-free" },
    ],
  },
};

export default function SignupTeaser({ variant }: { variant: "generate" | "remix" }) {
  const c = CONTENT[variant];
  return (
    <div className="relative overflow-hidden">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[700px] bg-primary/10 rounded-full blur-[140px] pointer-events-none" />
      <div className="container mx-auto max-w-5xl px-4 py-14 sm:py-20 relative z-10">
        <div className="text-center max-w-2xl mx-auto">
          <div className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-sm font-medium text-primary mb-5">
            <Sparkles className="mr-2 h-4 w-4" /> {c.badge}
          </div>
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight mb-4 leading-tight">{c.title}</h1>
          <p className="text-lg text-muted-foreground mb-8">{c.sub}</p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-4">
            <Link href="/register">
              <Button size="lg" className="w-full sm:w-auto h-12 px-8 text-base bg-gradient-electric text-white shadow-glow border-0 hover:opacity-90">
                Sign up free <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>
            <Link href="/pricing">
              <Button size="lg" variant="outline" className="w-full sm:w-auto h-12 px-8 text-base">
                See plans
              </Button>
            </Link>
          </div>
          <p className="text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link href="/login" className="text-primary underline underline-offset-4">Log in</Link>
          </p>
        </div>

        {/* Live sample reels */}
        <div className="grid grid-cols-3 gap-3 sm:gap-4 mt-12 max-w-3xl mx-auto">
          {SAMPLES.map((src) => (
            <div
              key={src}
              className="relative rounded-xl sm:rounded-2xl overflow-hidden bg-black border border-white/10 shadow-xl"
              style={{ aspectRatio: "9 / 16" }}
            >
              <video src={src} className="w-full h-full object-cover" autoPlay muted loop playsInline preload="metadata" />
            </div>
          ))}
        </div>

        {/* Feature bullets */}
        <div className="grid sm:grid-cols-2 gap-3 mt-12 max-w-3xl mx-auto">
          {c.bullets.map((b) => (
            <div key={b.text} className="flex items-center gap-3 rounded-xl border border-card-border bg-card/50 px-4 py-3">
              <div className="h-9 w-9 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
                <b.icon className="h-4 w-4 text-primary" />
              </div>
              <span className="text-sm">{b.text}</span>
            </div>
          ))}
        </div>

        <div className="text-center mt-12">
          <Link href="/register">
            <Button size="lg" className="bg-gradient-electric text-white shadow-glow border-0 hover:opacity-90">
              Create your free account <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
