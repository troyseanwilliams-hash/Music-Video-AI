import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Play, Sparkles, Zap, Music } from "lucide-react";
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
                Syncbeat.ai analyzes your audio tracks and generates stunning, beat-synced music videos perfectly matched to the mood, energy, and rhythm of your music.
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

        {/* Features Section */}
        <section className="py-20 bg-black/40 border-t border-border/30">
          <div className="container px-4 md:px-6 mx-auto">
            <div className="text-center max-w-3xl mx-auto mb-16">
              <h2 className="text-3xl font-bold tracking-tight mb-4">The professional pipeline</h2>
              <p className="text-muted-foreground">Everything you need to create compelling music videos in minutes, not weeks.</p>
            </div>
            
            <div className="grid md:grid-cols-3 gap-8">
              <div className="p-6 rounded-2xl bg-card border border-card-border shadow-lg">
                <div className="h-12 w-12 rounded-lg bg-primary/20 flex items-center justify-center mb-6">
                  <Music className="h-6 w-6 text-primary" />
                </div>
                <h3 className="text-xl font-bold mb-3">Deep Audio Analysis</h3>
                <p className="text-muted-foreground">Our engine breaks down your track's BPM, stems, mood, and drops to perfectly sync visual transitions with musical moments.</p>
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
                <p className="text-muted-foreground">Guide the generation with custom text prompts. You provide the creative direction, our AI handles the complex rendering.</p>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
