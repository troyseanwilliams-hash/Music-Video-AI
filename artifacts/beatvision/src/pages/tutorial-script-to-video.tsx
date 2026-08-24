import { Helmet } from "react-helmet-async";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { AuroraBackground } from "@/components/AuroraBackground";
import { CheckCircle2, XCircle, ArrowRight, ImagePlus, Scissors, Sparkles, Wand2, Layers, Zap, PenTool } from "lucide-react";

export default function TutorialScriptToVideo() {
  return (
    <div className="flex flex-col min-h-[calc(100vh-4rem)]">
      <Helmet>
        <title>How to Turn a Script into a Video | AIBeatSync</title>
        <meta name="description" content="Learn how to break down your script into numbered scene lists, generate consistent image sequences, and assemble them in Remix Lab to create intentional vertical videos." />
        <meta property="og:title" content="How to Turn a Script into a Video | AIBeatSync" />
        <meta property="og:description" content="Learn how to break down your script into numbered scene lists, generate consistent image sequences, and assemble them in Remix Lab to create intentional vertical videos." />
      </Helmet>

      <main className="flex-1 pb-20">
        <section className="relative py-16 md:py-24 overflow-hidden flex flex-col items-center border-b border-border/30">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-primary/10 rounded-full blur-[120px] pointer-events-none" />
          <AuroraBackground />
          <div className="container px-4 md:px-6 relative z-10 mx-auto max-w-4xl text-center">
            <div className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-sm font-medium text-primary mb-6 backdrop-blur-sm">
              <Sparkles className="mr-2 h-4 w-4" />
              Creator Guide
            </div>
            <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight mb-6 leading-tight">
              Turn Your Script Into a <span className="text-gradient-electric">Visual Story</span>
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground mb-10 max-w-2xl mx-auto">
              Learn how to break down any story, script, or podcast into a sequence of generated images, and assemble them into a compelling video in Remix Lab.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link href="/generate">
                <Button size="lg" className="w-full sm:w-auto h-12 px-8 bg-gradient-electric text-white shadow-glow hover:opacity-90 border-0 transition-all group" data-testid="tutorial-cta-generate">
                  <ImagePlus className="mr-2 h-5 w-5" />
                  Generate Images
                </Button>
              </Link>
              <Link href="/editor">
                <Button size="lg" variant="outline" className="w-full sm:w-auto h-12 px-8 border-accent/40 bg-secondary/50 hover:bg-accent/10 hover:text-accent hover:border-accent/60 backdrop-blur-sm transition-all" data-testid="tutorial-cta-remix">
                  <Scissors className="mr-2 h-5 w-5" />
                  Open Remix Lab
                </Button>
              </Link>
            </div>
          </div>
        </section>

        <div className="container mx-auto px-4 md:px-6 max-w-4xl py-12 md:py-20 space-y-24">
          
          {/* Step 1: The Script Breakdown */}
          <section>
            <div className="flex items-center gap-4 mb-6">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary font-bold text-lg">1</div>
              <h2 className="text-2xl md:text-3xl font-bold tracking-tight">The Script Breakdown</h2>
            </div>
            <p className="text-lg text-muted-foreground mb-8">
              AI generation thrives on specific, concrete descriptions. When you have a story, you can't just paste paragraphs of dialog and expect good visuals. You need to break the script down into a <strong>consecutively numbered descriptive scene list</strong>.
            </p>

            <div className="grid md:grid-cols-2 gap-8 mb-8">
              <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-6">
                <div className="flex items-center gap-2 text-destructive font-semibold mb-4">
                  <XCircle className="h-5 w-5" /> Don't do this
                </div>
                <div className="text-sm font-mono text-muted-foreground space-y-3">
                  <p>"Sarah walks into the dark room. She looks around nervously. 'Is anyone there?' she whispers. Suddenly a shadow moves in the corner."</p>
                </div>
                <p className="mt-6 text-sm text-foreground/80">
                  <strong className="block mb-1 text-destructive/90">Why it fails:</strong>
                  The AI doesn't know what Sarah looks like, it gets confused by dialog ("Is anyone there?"), and it might try to put the whole sequence into a single messy image, creating multi-panel comic book styles unintentionally.
                </p>
              </div>

              <div className="rounded-2xl border border-primary/30 bg-primary/5 p-6">
                <div className="flex items-center gap-2 text-primary font-semibold mb-4">
                  <CheckCircle2 className="h-5 w-5" /> Do this instead
                </div>
                <div className="text-sm font-mono text-foreground/90 space-y-3">
                  <p>1. Close up portrait of a young woman with short red hair looking nervous, dimly lit room, cinematic lighting.</p>
                  <p>2. Wide shot of a dark empty warehouse, a single shaft of moonlight hitting the dusty floor.</p>
                  <p>3. Close up of a mysterious shadow cast against a brick wall, eerie atmosphere.</p>
                </div>
                <p className="mt-6 text-sm text-foreground/80">
                  <strong className="block mb-1 text-primary/90">Why it works:</strong>
                  Numbered scenes tell our generator exactly how many images to make. Each line describes a single concrete visual moment without dialogue or complex timelines.
                </p>
              </div>
            </div>
          </section>

          {/* Step 2: Character & Visual Continuity */}
          <section>
            <div className="flex items-center gap-4 mb-6">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent font-bold text-lg">2</div>
              <h2 className="text-2xl md:text-3xl font-bold tracking-tight">Character & Visual Continuity</h2>
            </div>
            <p className="text-lg text-muted-foreground mb-8">
              To keep your character looking like the same person across multiple shots, you need to use the <strong>Reference Image</strong> feature and be consistent with your descriptions.
            </p>
            
            <div className="grid sm:grid-cols-3 gap-6">
              <div className="rounded-xl border border-border/50 bg-card p-5">
                <div className="h-10 w-10 rounded-lg bg-secondary flex items-center justify-center mb-4">
                  <ImagePlus className="h-5 w-5 text-muted-foreground" />
                </div>
                <h3 className="font-bold mb-2">Upload a Reference</h3>
                <p className="text-sm text-muted-foreground">In the Generator, toggle "Images only" and upload a face or style reference image to anchor the AI.</p>
              </div>
              <div className="rounded-xl border border-border/50 bg-card p-5">
                <div className="h-10 w-10 rounded-lg bg-secondary flex items-center justify-center mb-4">
                  <PenTool className="h-5 w-5 text-muted-foreground" />
                </div>
                <h3 className="font-bold mb-2">Consistent Traits</h3>
                <p className="text-sm text-muted-foreground">Always describe your character the same way: "young man with a green beanie and round glasses".</p>
              </div>
              <div className="rounded-xl border border-border/50 bg-card p-5">
                <div className="h-10 w-10 rounded-lg bg-secondary flex items-center justify-center mb-4">
                  <Layers className="h-5 w-5 text-muted-foreground" />
                </div>
                <h3 className="font-bold mb-2">Lock the Style</h3>
                <p className="text-sm text-muted-foreground">Choose a specific aesthetic (like Cinematic or Anime) and stick with it across all your generated packs.</p>
              </div>
            </div>
          </section>

          {/* Step 3: Avoiding Bad Prompts */}
          <section>
            <div className="flex items-center gap-4 mb-6">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary font-bold text-lg">3</div>
              <h2 className="text-2xl md:text-3xl font-bold tracking-tight">Avoiding Vague & Repetitive Prompts</h2>
            </div>
            <p className="text-lg text-muted-foreground mb-8">
              The AI doesn't understand narrative flow — it only understands the current frame. If you want variety, you have to force it.
            </p>

            <div className="space-y-6">
              <div className="flex gap-4 p-5 rounded-xl border border-border/50 bg-card">
                <div className="mt-1">
                  <XCircle className="h-5 w-5 text-destructive" />
                </div>
                <div>
                  <h4 className="font-bold text-foreground">Vague Actions</h4>
                  <p className="text-sm text-muted-foreground mt-1">"She realizes the truth." The AI can't draw a realization. Instead write: "Close up of a woman's face, eyes wide wide in shock, dropping a coffee cup."</p>
                </div>
              </div>

              <div className="flex gap-4 p-5 rounded-xl border border-border/50 bg-card">
                <div className="mt-1">
                  <XCircle className="h-5 w-5 text-destructive" />
                </div>
                <div>
                  <h4 className="font-bold text-foreground">Repetitive Shots</h4>
                  <p className="text-sm text-muted-foreground mt-1">If all your prompts start with "A man walking...", you will get 10 identical images. Vary your camera angles: "Wide shot...", "Extreme close up...", "Low angle...", "Over the shoulder shot..."</p>
                </div>
              </div>

              <div className="flex gap-4 p-5 rounded-xl border border-border/50 bg-card">
                <div className="mt-1">
                  <XCircle className="h-5 w-5 text-destructive" />
                </div>
                <div>
                  <h4 className="font-bold text-foreground">Multi-Panel Prompts</h4>
                  <p className="text-sm text-muted-foreground mt-1">"He runs, then jumps, then lands." The AI might draw three different panels in one image. Keep each line focused on a <strong>single frozen moment in time</strong>.</p>
                </div>
              </div>
            </div>
          </section>

          {/* Step 4: Assembly */}
          <section>
            <div className="flex items-center gap-4 mb-6">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent font-bold text-lg">4</div>
              <h2 className="text-2xl md:text-3xl font-bold tracking-tight">Assembling in Remix Lab</h2>
            </div>
            <p className="text-lg text-muted-foreground mb-6">
              Once you have your images, it's time to build the video.
            </p>
            
            <div className="relative rounded-2xl border border-border bg-black/40 overflow-hidden p-6 md:p-10 text-center">
              <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-accent/5 pointer-events-none" />
              
              <div className="relative z-10 grid md:grid-cols-3 gap-8 text-left">
                <div>
                  <div className="flex items-center gap-3 mb-3">
                    <Zap className="h-5 w-5 text-accent" />
                    <h3 className="font-bold">1. Upload Audio</h3>
                  </div>
                  <p className="text-sm text-muted-foreground">Open Remix Lab and drag in your voiceover, podcast clip, or music track. The timeline will adjust to fit.</p>
                </div>
                <div>
                  <div className="flex items-center gap-3 mb-3">
                    <Layers className="h-5 w-5 text-accent" />
                    <h3 className="font-bold">2. Drop Images</h3>
                  </div>
                  <p className="text-sm text-muted-foreground">Select your generated images from your Gallery and add them to the timeline in sequence.</p>
                </div>
                <div>
                  <div className="flex items-center gap-3 mb-3">
                    <Wand2 className="h-5 w-5 text-accent" />
                    <h3 className="font-bold">3. Time & Transition</h3>
                  </div>
                  <p className="text-sm text-muted-foreground">Drag the edges of each image to match the spoken words. Add smooth crossfades between clips, then Export.</p>
                </div>
              </div>

              <div className="mt-10 pt-10 border-t border-border/50">
                <Link href="/editor">
                  <Button size="lg" className="bg-gradient-electric text-white shadow-glow hover:opacity-90 border-0" data-testid="tutorial-bottom-cta-remix">
                    Try Remix Lab Now <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
              </div>
            </div>
          </section>

        </div>
      </main>
    </div>
  );
}
