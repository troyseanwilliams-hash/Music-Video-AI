import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Play, Sparkles, Zap, Music, MonitorPlay, ExternalLink } from "lucide-react";
import { motion } from "framer-motion";

export default function Home() {
  return (
    <div className="flex flex-col min-h-[calc(100vh-4rem)]">
      <main className="flex-1">
        {/* Hero Section */}
        <section className="relative py-20 md:py-32 overflow-hidden flex items-center">
          {/* Abstract background elements */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-primary/20 rounded-full blur-[120px] pointer-events-none" />
          <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-accent/20 rounded-full blur-[100px] pointer-events-none" />
          
          <div className="container px-4 md:px-6 relative z-10 mx-auto text-center max-w-5xl">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
            >
              <div className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-sm font-medium text-primary mb-6 backdrop-blur-sm">
                <Sparkles className="mr-2 h-4 w-4" />
                Next-Gen Audio-Reactive AI
              </div>
              
              <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight mb-6 leading-tight">
                Turn your music into <br />
                <span className="text-gradient-electric">cinematic visuals</span>
              </h1>
              
              <p className="text-lg md:text-xl text-muted-foreground mb-10 max-w-2xl mx-auto">
                AI Beat Sync analyzes your audio tracks and generates stunning, beat-synced music videos perfectly matched to the mood, energy, and rhythm of your music.
              </p>
              
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Link href="/generate">
                  <Button size="lg" className="w-full sm:w-auto text-lg h-14 px-8 bg-gradient-electric text-white shadow-glow hover:opacity-90 border-0 transition-all group">
                    <Play className="mr-2 h-5 w-5 group-hover:scale-110 transition-transform" />
                    Start Creating
                  </Button>
                </Link>
                <Link href="/gallery">
                  <Button size="lg" variant="outline" className="w-full sm:w-auto text-lg h-14 px-8 border-border/50 bg-secondary/50 hover:bg-secondary/80 backdrop-blur-sm">
                    View Gallery
                  </Button>
                </Link>
              </div>
            </motion.div>
          </div>
        </section>

        {/* Spotify Canvas Callout */}
        <section className="py-16 border-t border-border/30 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-[#1DB954]/10 via-transparent to-primary/10 pointer-events-none" />
          <div className="container px-4 md:px-6 mx-auto relative z-10">
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5 }}
              className="flex flex-col md:flex-row items-center gap-8 md:gap-16"
            >
              {/* Left: icon + label */}
              <div className="flex-shrink-0 flex flex-col items-center md:items-start gap-4 text-center md:text-left">
                <div className="h-20 w-20 rounded-2xl flex items-center justify-center shadow-lg"
                  style={{ background: "linear-gradient(135deg,#1DB954 0%,#158a3e 100%)" }}>
                  <MonitorPlay className="h-10 w-10 text-white" />
                </div>
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-[#1DB954] border border-[#1DB954]/30 rounded-full px-3 py-1 bg-[#1DB954]/10">
                  Spotify Canvas ready
                </span>
              </div>

              {/* Center: copy */}
              <div className="flex-1">
                <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight mb-3">
                  Create 5-second Canvas videos<br className="hidden md:block" /> for Spotify &amp; beyond
                </h2>
                <p className="text-muted-foreground text-lg mb-4 max-w-2xl">
                  Spotify Canvas loops a short video behind your track in the app — boosting streams, shares, and listener retention by up to 145%. Generate a perfectly sized, beat-synced 5-second clip in one click and upload it straight to Spotify for Artists. Works for Apple Music, TikTok previews, YouTube Shorts, and any platform that supports short-form video.
                </p>
                <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm text-muted-foreground mb-6">
                  {[
                    "5s looping clip — exact Spotify Canvas format",
                    "Beat-synced to your track's drop or hook",
                    "8 cinematic visual styles to choose from",
                    "Download & upload in minutes, not days",
                  ].map((item) => (
                    <li key={item} className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-[#1DB954] flex-shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
                <Link href="/generate">
                  <Button className="bg-[#1DB954] hover:bg-[#1DB954]/90 text-white font-semibold shadow-md">
                    <Play className="mr-2 h-4 w-4" />
                    Make your Canvas now
                  </Button>
                </Link>
              </div>

              {/* Right: platform badges */}
              <div className="flex-shrink-0 flex flex-col gap-3 text-sm">
                {[
                  { name: "Spotify Canvas", color: "#1DB954" },
                  { name: "Apple Music", color: "#fc3c44" },
                  { name: "TikTok Preview", color: "#69C9D0" },
                  { name: "YouTube Shorts", color: "#FF0000" },
                ].map((p) => (
                  <div
                    key={p.name}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl border bg-card/50"
                    style={{ borderColor: `${p.color}40` }}
                  >
                    <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ background: p.color }} />
                    <span className="font-medium text-foreground/80">{p.name}</span>
                    <ExternalLink className="h-3 w-3 ml-auto text-muted-foreground/50" />
                  </div>
                ))}
              </div>
            </motion.div>
          </div>
        </section>

        {/* Features Section */}
        <section className="py-20 bg-black/40 border-t border-border/30">
          <div className="container px-4 md:px-6 mx-auto">
            <div className="text-center max-w-3xl mx-auto mb-16">
              <h2 className="text-3xl font-bold tracking-tight mb-4">The professional pipeline</h2>
              <p className="text-muted-foreground">Everything you need to create compelling music videos in minutes, not weeks.</p>
            </div>
            
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
              <div className="p-6 rounded-2xl bg-card border border-card-border shadow-lg">
                <div className="h-12 w-12 rounded-lg bg-primary/20 flex items-center justify-center mb-6">
                  <Music className="h-6 w-6 text-primary" />
                </div>
                <h3 className="text-xl font-bold mb-3">Deep Audio Analysis</h3>
                <p className="text-muted-foreground">Our engine breaks down your track's BPM, mood, energy, and section structure to perfectly sync visual transitions with musical moments.</p>
              </div>
              
              <div className="p-6 rounded-2xl bg-card border border-card-border shadow-lg">
                <div className="h-12 w-12 rounded-lg bg-accent/20 flex items-center justify-center mb-6">
                  <Zap className="h-6 w-6 text-accent" />
                </div>
                <h3 className="text-xl font-bold mb-3">8 Cinematic Styles</h3>
                <p className="text-muted-foreground">From gritty documentary looks to ethereal fantasy worlds, choose the perfect visual aesthetic to match your sound.</p>
              </div>
              
              <div className="p-6 rounded-2xl bg-card border border-card-border shadow-lg">
                <div className="h-12 w-12 rounded-lg bg-pink-500/20 flex items-center justify-center mb-6">
                  <Sparkles className="h-6 w-6 text-pink-500" />
                </div>
                <h3 className="text-xl font-bold mb-3">Prompt-Driven</h3>
                <p className="text-muted-foreground">Guide the generation with custom text prompts and an optional reference image. You set the creative direction, our AI handles the rendering.</p>
              </div>

              <div className="p-6 rounded-2xl bg-card border border-[#1DB954]/30 shadow-lg">
                <div className="h-12 w-12 rounded-lg flex items-center justify-center mb-6"
                  style={{ background: "rgba(29,185,84,0.15)" }}>
                  <MonitorPlay className="h-6 w-6" style={{ color: "#1DB954" }} />
                </div>
                <h3 className="text-xl font-bold mb-3">Spotify Canvas Format</h3>
                <p className="text-muted-foreground">Generate 5-second looping clips sized and formatted for Spotify Canvas — ready to upload to Spotify for Artists the moment they're done.</p>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
