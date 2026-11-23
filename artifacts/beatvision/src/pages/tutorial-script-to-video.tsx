import { Helmet } from "react-helmet-async";
import { Link } from "wouter";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { AuroraBackground } from "@/components/AuroraBackground";
import { Check, CheckCircle2, Copy, XCircle, ArrowRight, ImagePlus, Scissors, Sparkles, Wand2, Layers, Zap, PenTool } from "lucide-react";

const EXAMPLE_MONTAGE_SCRIPT = [
  "1. Dawn over a windswept Kansas prairie, young Amelia Earhart watches a distant biplane rise through golden mist.",
  "2. Amelia Earhart as a young aviation dreamer at an airfield, reaching toward the wing of a bright red vintage aircraft.",
  "3. 1920s women pilots gathered beside a hangar, Amelia stepping forward with calm determination in period aviation clothing.",
  "4. Amelia climbing into an open cockpit biplane before a transatlantic attempt, mechanics tightening cables around her.",
  "5. Aerial view of the Atlantic Ocean beneath a small vintage aircraft, vast blue distance and clouds racing below.",
  "6. Amelia in a leather flight helmet and goggles, hands steady on the controls inside a vibrating open cockpit.",
  "7. Storm clouds building over the ocean, the tiny biplane cutting through turbulent air with dramatic sunlight breaking through.",
  "8. Night flight above dark water, instrument panel glowing softly while Amelia studies a compass and keeps her course.",
  "9. A lonely lighthouse and rugged coastline emerging through fog as the aircraft approaches land after a dangerous crossing.",
  "10. Crowds gathering on a 1920s runway, Amelia stepping down from the plane into camera flashes and waving flags without readable text.",
  "11. Amelia beside her aircraft in a leather jacket, smiling modestly while reporters and photographers surround the historic moment.",
  "12. Close detail of Amelia's gloved hand tracing a flight map across the Atlantic, brass compass and folded route lines on a table.",
  "13. Amelia walking through a quiet workshop, aircraft parts, tools, and blueprints surrounding her as she plans the next record.",
  "14. A long-distance aircraft being prepared at a remote runway, fuel crew moving with urgency under a vast copper sunset.",
  "15. Amelia launching into open sky from a grass airfield, propeller blur and wind pulling at her scarf, triumphant forward motion.",
  "16. The aircraft crossing mountain ranges from above, snow peaks and deep valleys sliding beneath the wings in clear morning light.",
  "17. A wide Pacific horizon at dusk, the aircraft silhouetted against rose and indigo clouds, an uncertain final journey ahead.",
  "18. Empty ocean and drifting cloud shadows beneath a fading flight path, a single compass turning slowly in the foreground.",
  "19. A weathered leather flight jacket and goggles resting beside an old map, warm window light and dust motes creating a memorial still life.",
  "20. A diverse group of modern young women studying aviation beneath a suspended vintage aircraft, inspired by Amelia's legacy.",
].join("\n");

const EXAMPLE_NARRATIVE_SCRIPT = [
  "1. Young pilot Amelia Earhart stands on a windswept Kansas prairie at dawn, watching a distant biplane rise through golden mist and feeling the first spark of aviation wonder.",
  "2. At a sunlit airfield, pilot Amelia approaches a bright red vintage aircraft and reaches toward its wing, newly certain that flying will shape her future.",
  "3. Amelia studies aviation beside a busy 1920s hangar, surrounded by women pilots, tools, and aircraft plans while she gathers the courage to enter their world.",
  "4. Pilot Amelia climbs into an open-cockpit biplane before her first major crossing, while mechanics tighten cables and prepare the aircraft around her.",
  "5. The biplane lifts from the runway and carries Amelia above the Atlantic Ocean, the small aircraft surrounded by vast blue distance and racing clouds.",
  "6. Inside the vibrating open cockpit, pilot Amelia steadies the controls in her leather helmet and goggles, learning to trust her hands and read the changing sky.",
  "7. A storm overtakes the aircraft above the ocean, and Amelia holds her course through turbulent air as a narrow beam of sunlight breaks through the clouds.",
  "8. Night settles over dark water; pilot Amelia studies a softly glowing instrument panel and compass, making a careful correction to keep the aircraft on course.",
  "9. After the dangerous crossing, a lonely lighthouse and rugged coastline emerge through fog ahead of Amelia, offering the first sign that land is near.",
  "10. Pilot Amelia lands on a 1920s runway and steps down from the aircraft into camera flashes, waving flags, and a crowd recognizing the historic achievement without readable text.",
  "11. In the quiet after the celebration, pilot Amelia stands beside her aircraft in a leather jacket while reporters and photographers capture the moment.",
  "12. Pilot Amelia returns to a worktable and traces a new flight route across an Atlantic map, her gloved hand beside a brass compass and folded navigation lines.",
  "13. Pilot Amelia walks through a workshop filled with aircraft parts, tools, and blueprints, turning the memory of her crossing into plans for an even greater record.",
  "14. At a remote runway beneath a copper sunset, a long-distance aircraft is fueled and repaired while Amelia watches the crew prepare for departure.",
  "15. Pilot Amelia launches again from a grass airfield, scarf lifting in the wind and propeller blurring as the aircraft surges toward another uncertain horizon.",
  "16. The aircraft crosses snow-covered mountain ranges, deep valleys moving beneath its wings as Amelia continues forward through clear morning light.",
  "17. At dusk, the aircraft reaches a wide Pacific horizon, silhouetted against rose and indigo clouds as Amelia begins the most uncertain journey of her story.",
  "18. Empty ocean stretches beneath a fading flight path while a compass turns in the foreground, holding the unanswered tension of Amelia's final journey.",
  "19. Warm window light falls across Amelia's weathered flight jacket, goggles, and old map resting in stillness, transforming the journey into a quiet memorial.",
  "20. In the present day, young women study aviation beneath a suspended vintage aircraft, carrying Amelia's courage forward into a hopeful future.",
].join("\n");

export const COMMENTARY_STEPS = [
  { title: "Add your main video", body: "In the Media tab, add your episode or source video as the main track. The preview and timeline stay visible while you switch between tabs." },
  { title: "Add overlays", body: "Open the Overlay tab to upload video clips, add static images, choose existing project or Gallery media, or create text cards. You can layer multiple items over the main video." },
  { title: "Choose an overlay layout", body: "Commentary centers your clip over a blurred copy. Reaction layouts place a smaller clip on the left or right; drag it in the preview to reposition or resize it. Center 16:9 keeps the overlay centered and blurs the sides, and decorative border presets frame video and image overlays." },
  { title: "Set overlay timing", body: "Select an overlay to set its start time and duration, or place it at the playhead. Drag its bar in the timeline to change when it appears. Each overlay keeps its own timing when you save the project." },
  { title: "Add background or timed music", body: "In Audio, Background music sets a continuous soundtrack. For music only during selected moments, add multiple timed music clips and set each clip's start and duration. Set fade-in and fade-out times; the underlying video audio is muted during each music slot and returns when it ends." },
  { title: "Mix audio and add text", body: "Adjust background music and overlay sound separately. Add text cards in Overlay for titles or facts; press Enter wherever you want a line break. Preview your changes before exporting." },
  { title: "Save your project", body: "Use Save or Save as to keep your media arrangement, overlay timing and styles, and timed music clips together so you can reopen the edit later." },
  { title: "Review and export", body: "Open Export, choose your video name, resolution and orientation, then review the estimate and confirm you have rights to the content. Export & render MP4 starts the render." },
];

function ExampleScriptCard({
  kind,
  title,
  description,
  script,
  copied,
  onCopy,
}: {
  kind: "montage" | "narrative";
  title: string;
  description: string;
  script: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/[0.08] via-card to-accent/[0.05] p-6">
      <div className="flex flex-col gap-4">
        <div>
          <div className="flex items-center gap-2 text-primary font-semibold">
            <Sparkles className="h-5 w-5" />
            {kind === "montage" ? "Still-image montage" : "Narrative Story"}
          </div>
          <h3 className="mt-2 text-xl font-bold">{title}</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="w-full border-primary/30 hover:border-primary/60 hover:bg-primary/10"
          onClick={onCopy}
          data-testid={`button-copy-${kind}-script`}
        >
          {copied ? <Check className="mr-2 h-4 w-4 text-primary" /> : <Copy className="mr-2 h-4 w-4" />}
          {copied ? "Copied" : "Copy 20-scene script"}
        </Button>
      </div>
      <details className="group mt-6">
        <summary className="cursor-pointer text-sm font-medium text-primary hover:text-primary/80">
          Show the complete 20-scene script
        </summary>
        <pre className="mt-4 max-h-[26rem] overflow-auto whitespace-pre-wrap rounded-xl border border-border/60 bg-background/70 p-4 text-xs leading-relaxed text-foreground/85">
          {script}
        </pre>
      </details>
      <div className="mt-5 grid gap-3 text-sm text-muted-foreground">
        {kind === "montage" ? (
          <>
            <p><strong className="text-foreground">1.</strong> Paste the numbered list into <Link href="/images" className="text-primary underline-offset-4 hover:underline">Create Images</Link> and review the credit estimate before creating.</p>
            <p><strong className="text-foreground">2.</strong> In <Link href="/editor" className="text-primary underline-offset-4 hover:underline">Creator Studio</Link>, choose Generated images and add the pack.</p>
            <p><strong className="text-foreground">3.</strong> Add your track, then set each still's hold time on the timeline.</p>
          </>
        ) : (
          <>
            <p><strong className="text-foreground">1.</strong> Open <Link href="/generate" className="text-primary underline-offset-4 hover:underline">Generate Video</Link>; every video there is a narrative story.</p>
            <p><strong className="text-foreground">2.</strong> Paste one numbered line for each analyzed segment.</p>
            <p><strong className="text-foreground">3.</strong> Confirm the required prompt count and credit estimate before submitting.</p>
          </>
        )}
      </div>
    </div>
  );
}

export default function TutorialScriptToVideo() {
  const [copiedExample, setCopiedExample] = useState<"montage" | "narrative" | null>(null);

  const copyExampleScript = async (kind: "montage" | "narrative", script: string) => {
    try {
      await navigator.clipboard.writeText(script);
      setCopiedExample(kind);
      window.setTimeout(() => setCopiedExample(null), 1800);
    } catch {
      setCopiedExample(null);
    }
  };

  return (
    <div className="flex flex-col min-h-[calc(100vh-4rem)]">
      <Helmet>
        <title>How to Turn a Script into a Video | AIBeatSync</title>
        <meta name="description" content="Learn how to break down your script into numbered scene lists, create consistent image sequences, assemble them in Creator Studio, and add commentary overlays and text cards." />
        <meta property="og:title" content="How to Turn a Script into a Video | AIBeatSync" />
        <meta property="og:description" content="Learn how to break down your script into numbered scene lists, generate consistent image sequences, and assemble them in Creator Studio to create intentional vertical videos." />
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
              Learn how to break down any story, script, or podcast into a sequence of generated images, and assemble them into a compelling video in Creator Studio.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link href="/images">
                <Button size="lg" className="w-full sm:w-auto h-12 px-8 bg-gradient-electric text-white shadow-glow hover:opacity-90 border-0 transition-all group" data-testid="tutorial-cta-generate">
                  <ImagePlus className="mr-2 h-5 w-5" />
                  Create Images
                </Button>
              </Link>
              <Link href="/editor">
                <Button size="lg" variant="outline" className="w-full sm:w-auto h-12 px-8 border-accent/40 bg-secondary/50 hover:bg-accent/10 hover:text-accent hover:border-accent/60 backdrop-blur-sm transition-all" data-testid="tutorial-cta-remix">
                  <Scissors className="mr-2 h-5 w-5" />
                  Open Creator Studio
                </Button>
              </Link>
            </div>
            <p className="mt-6 text-sm text-muted-foreground">
              New: <a href="#commentary-overlays" className="text-primary underline-offset-4 hover:underline" data-testid="link-tutorial-commentary">commentary and reaction overlays</a>{" "}
              &middot; <Link href="/whats-new" className="text-primary underline-offset-4 hover:underline" data-testid="link-tutorial-whats-new">What's New, November 9, 2026</Link>
            </p>
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

            <div className="mb-6 rounded-2xl border border-accent/25 bg-accent/[0.06] p-6 md:p-8">
              <div className="flex items-center gap-2 text-accent font-semibold">
                <Layers className="h-5 w-5" />
                Pick the right place for your script
              </div>
              <h3 className="mt-2 text-xl font-bold">Both use numbered prompts, but they live in different tools</h3>
              <div className="mt-5 grid gap-5 md:grid-cols-2">
                <div className="rounded-xl border border-border/60 bg-background/40 p-4">
                  <p className="font-semibold text-foreground">Still-image montage: Create Images, then Creator Studio</p>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    Each line is an independent visual idea. Create the stills in Create Images, then add them in
                    Creator Studio with Generated images and cut them to your music or narration. The scenes do not need to form a plot.
                  </p>
                </div>
                <div className="rounded-xl border border-border/60 bg-background/40 p-4">
                  <p className="font-semibold text-foreground">Narrative Story: Generate Video</p>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    Generate creates one cohesive narrative video; there is no montage option inside it. Each line is the next beat in one chronological story. Repeat important character traits, keep
                    locations and actions connected, and write an ending that resolves the journey.
                  </p>
                </div>
              </div>
              <p className="mt-5 text-sm text-muted-foreground">
                In Generate, the uploaded track is analyzed first. If the analysis says the video needs 20
                segments, provide exactly 20 numbered lines to control every segment. AI generation uses credits;
                review the estimate shown before you submit.
              </p>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <ExampleScriptCard
                kind="montage"
                title="Still-image montage example"
                description="Use this for a beat-driven Amelia Earhart music video. The images are varied and visually independent rather than written as one continuous plot."
                script={EXAMPLE_MONTAGE_SCRIPT}
                copied={copiedExample === "montage"}
                onCopy={() => copyExampleScript("montage", EXAMPLE_MONTAGE_SCRIPT)}
              />
              <ExampleScriptCard
                kind="narrative"
                title="Narrative Story example"
                description="Use this for a chronological Amelia Earhart story. The scenes move from discovery, to achievement, to uncertainty, and finally to her lasting legacy."
                script={EXAMPLE_NARRATIVE_SCRIPT}
                copied={copiedExample === "narrative"}
                onCopy={() => copyExampleScript("narrative", EXAMPLE_NARRATIVE_SCRIPT)}
              />
            </div>

            <div className="mt-6 rounded-xl border border-border/50 bg-card p-5 text-sm text-muted-foreground">
              <strong className="text-foreground">How to use either example:</strong>{" "}
              For the montage script, paste it into Create Images, then assemble the stills in Creator Studio.
              For the narrative script, upload the full track in Generate, paste it into Creative Prompt,
              and wait for the page to confirm the required prompt count and estimate before submitting.
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
                <p className="text-sm text-muted-foreground">In Create Images or the Character Reference section of Generate, add a face or style reference image to anchor the AI.</p>
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
              <h2 className="text-2xl md:text-3xl font-bold tracking-tight">Assembling in Creator Studio</h2>
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
                  <p className="text-sm text-muted-foreground">Open Creator Studio and drag in your voiceover, podcast clip, or music track. The timeline will adjust to fit.</p>
                </div>
                <div>
                  <div className="flex items-center gap-3 mb-3">
                    <Layers className="h-5 w-5 text-accent" />
                    <h3 className="font-bold">2. Drop Images</h3>
                  </div>
                  <p className="text-sm text-muted-foreground">Choose Generated images in Creator Studio, select the pack you made in Create Images, and add it in sequence.</p>
                </div>
                <div>
                  <div className="flex items-center gap-3 mb-3">
                    <Wand2 className="h-5 w-5 text-accent" />
                    <h3 className="font-bold">3. Time & Transition</h3>
                  </div>
                  <p className="text-sm text-muted-foreground">Drag images into order, then select each one to set its hold time to match the spoken words. Add a transition, review the estimate, then Export.</p>
                </div>
              </div>

              <div className="mt-10 pt-10 border-t border-border/50">
                <Link href="/editor">
                  <Button size="lg" className="bg-gradient-electric text-white shadow-glow hover:opacity-90 border-0" data-testid="tutorial-bottom-cta-remix">
                    Try Creator Studio Now <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
              </div>
            </div>
          </section>

          {/* Step 5: Commentary overlays */}
          <section id="commentary-overlays" data-testid="section-commentary-overlays">
            <div className="flex items-center gap-4 mb-6">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary font-bold text-lg">5</div>
              <h2 className="text-2xl md:text-3xl font-bold tracking-tight">Commentary and Reaction Overlays</h2>
            </div>
            <p className="text-lg text-muted-foreground mb-8">
              For podcasts and commentary videos, keep your episode as the main track and layer a second clip and text cards on top.
              It is optional: if you only need one track, nothing changes.
            </p>
            <ol className="grid gap-4 md:grid-cols-2">
              {COMMENTARY_STEPS.map((item, i) => (
                <li key={item.title} className="rounded-xl border border-border/50 bg-card p-5">
                  <h3 className="font-bold"><span className="mr-2 text-primary">{i + 1}.</span>{item.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.body}</p>
                </li>
              ))}
            </ol>
            <div className="mt-6 rounded-xl border border-accent/25 bg-accent/[0.06] p-5 text-sm text-muted-foreground">
              <strong className="text-foreground">Limits and rights:</strong> Creator Studio exports at up to 1080p and supports
              timelines up to 30 minutes. That 30-minute limit is for Creator Studio only, not AI video generation.
              Clips are shown in full, so any watermark already in a source clip stays visible. Only use footage you own or are licensed to use, and confirm rights before exporting.
            </div>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Link href="/editor?guide=commentary">
                <Button className="w-full sm:w-auto bg-gradient-electric text-white border-0 hover:opacity-90" data-testid="tutorial-cta-commentary-guide">
                  Start the commentary walkthrough <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
              <Link href="/whats-new">
                <Button variant="outline" className="w-full sm:w-auto" data-testid="tutorial-cta-whats-new">Read the release notes</Button>
              </Link>
            </div>
          </section>

        </div>
      </main>
    </div>
  );
}
