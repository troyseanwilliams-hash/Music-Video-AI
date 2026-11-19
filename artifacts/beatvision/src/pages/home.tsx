import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { track } from "@/lib/analytics";
import { useAuth } from "@/hooks/useAuth";
import { buildAuthUrl } from "@/lib/authIntent";
import {
  ArrowRight,
  Play,
  Volume2,
  ImageIcon,
  Sparkles,
  Music,
  Scissors,
  Lock,
  Clapperboard,
  Share2,
  Wand2,
  Mic2,
  Eye,
  CheckCircle2,
  Layers,
  Wallet,
  Activity,
  CreditCard,
  AudioWaveform
} from "lucide-react";
import { motion } from "framer-motion";
import { AuroraBackground } from "@/components/AuroraBackground";
import { PhotoAnimationShowcase } from "@/components/PhotoAnimationShowcase";

import { useSEO } from "@/hooks/useSEO";
import { FREE_OFFER_COPY, freeOfferTerms } from "@/lib/freeOffer";

const CREATE_PATHS = [
  { id: "music-video", title: "Music video", desc: "Opens the AI video generator. Uses credits.", cta: "Start", to: "/generate", action: "path_music_video", icon: Clapperboard },
  { id: "lyric-video", title: "Lyric video", desc: "Opens the video generator, where you can add lyric captions.", cta: "Start", to: "/generate", action: "path_lyric_video", icon: Mic2 },
  { id: "animate-photo", title: "Animate a photo", desc: "Opens your gallery images to animate one. Uses credits.", cta: "Pick a photo", to: "/gallery?tab=images&action=animate", action: "path_animate_photo", icon: ImageIcon },
] as const;

const GUIDES = [
  { label: "AI music videos", to: "/ai-music-video-generator" },
  { label: "Lyric videos", to: "/ai-lyric-video" },
  { label: "Suno to video", to: "/suno-to-video" },
] as const;

export default function Home() {
  useSEO({
    title: "AI Studio for Music and Video",
    description: `Turn your audio into visual stories with AIBeatSync. ${FREE_OFFER_COPY.short}`,
    canonical: "/",
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "WebApplication",
      "name": "AIBeatSync",
      "applicationCategory": "MultimediaApplication",
      "offers": {
        "@type": "Offer",
        "price": "0",
        "priceCurrency": "USD",
        "description": freeOfferTerms
      }
    }
  });

  const { isAuthenticated } = useAuth();
  const trackCTA = (location: string, action: string, label: string) => {
    track("cta_click", { location, action, label });
  };

  return (
    <div className="flex flex-col min-h-[calc(100vh-4rem)] bg-black text-white selection:bg-primary/30">
      <main className="flex-1">
        {/* Cinematic Hero Section */}
        <section className="relative min-h-[90vh] flex items-center justify-center overflow-hidden border-b border-white/5">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-primary/20 rounded-full blur-[150px] pointer-events-none opacity-50 z-0" />
          <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-accent/20 rounded-full blur-[120px] pointer-events-none opacity-40 z-0" />
          <div className="absolute inset-0 z-0">
            <AuroraBackground />
          </div>
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-black/40 to-black pointer-events-none z-0" />
          
          <div className="container relative z-10 px-4 md:px-6 mx-auto max-w-6xl pt-16 md:pt-24 pb-16">
            <div className="flex flex-col lg:flex-row items-center gap-12 lg:gap-8">
              <motion.div
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, ease: "easeOut" }}
                className="flex flex-col items-center lg:items-start text-center lg:text-left flex-1"
              >
                <div className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-sm font-medium text-white/80 mb-6 backdrop-blur-md">
                  <Sparkles className="mr-2 h-4 w-4 text-primary" />
                  Music videos, lyric videos and animated photos
                </div>

                <h1 className="text-4xl sm:text-5xl md:text-7xl font-extrabold tracking-tighter mb-6 leading-[1.1]">
                  Make a video <br className="hidden sm:block" />
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-accent">for your song.</span>
                </h1>

                <p className="text-base sm:text-lg md:text-xl text-white/60 mb-8 max-w-xl lg:mx-0 font-light leading-relaxed">
                  Upload a track and pick how you want to start. AI generation creates new visuals from prompts and uses credits. Creator Studio edits your own clips and photos on a timeline.
                </p>

                <div className="grid w-full gap-3 sm:grid-cols-3" data-testid="group-creation-paths">
                  {CREATE_PATHS.map((p) => (
                    <Link
                      key={p.id}
                      href={isAuthenticated ? p.to : buildAuthUrl("/register", { returnTo: p.to })}
                      onClick={() => trackCTA("hero_paths", p.action, p.title)}
                      data-testid={`link-path-${p.id}`}
                      className="group flex flex-col items-start gap-2 rounded-2xl border border-white/10 bg-white/5 p-4 text-left backdrop-blur-md transition-colors hover:border-primary/40 hover:bg-white/10"
                    >
                      <p.icon className="h-5 w-5 text-primary" />
                      <span className="font-semibold text-white">{p.title}</span>
                      <span className="text-xs leading-snug text-white/55">{p.desc}</span>
                      <span className="mt-auto flex items-center text-xs font-medium text-white/80">
                        {p.cta} <ArrowRight className="ml-1 h-3 w-3 transition-transform group-hover:translate-x-1" />
                      </span>
                    </Link>
                  ))}
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-center lg:justify-start gap-x-4 gap-y-1 text-xs text-white/50" data-testid="group-guides">
                  <span>Guides:</span>
                  {GUIDES.map((g) => (
                    <Link key={g.to} href={g.to} onClick={() => trackCTA("hero_guides", "view_guide", g.label)} className="underline underline-offset-4 hover:text-white" data-testid={`link-guide-${g.to.slice(1)}`}>
                      {g.label}
                    </Link>
                  ))}
                  <span className="text-white/40">Prefer your own footage? <Link href={isAuthenticated ? "/editor" : buildAuthUrl("/register", { returnTo: "/editor" })} onClick={() => trackCTA("hero_guides", "open_editor", "Creator Studio")} className="underline underline-offset-4 hover:text-white" data-testid="link-hero-montage">Creator Studio</Link></span>
                </div>

                {!isAuthenticated && (
                  <div className="mt-5 w-full max-w-xl rounded-2xl border border-primary/25 bg-primary/10 p-4 text-left" data-testid="panel-free-offer">
                    <p className="text-sm font-semibold text-white">{FREE_OFFER_COPY.short}</p>
                    <p className="mt-1 text-xs text-white/70">{FREE_OFFER_COPY.example}</p>
                    <p className="mt-1 text-xs text-white/70">{FREE_OFFER_COPY.expiry}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <Link
                        href={buildAuthUrl("/register", { returnTo: "/generate" })}
                        onClick={() => trackCTA("hero", "register", "Create free account")}
                        data-testid="link-hero-register"
                      >
                        <Button size="sm" className="rounded-full bg-white text-black hover:bg-white/90">
                          Create free account <ArrowRight className="ml-1 h-4 w-4" />
                        </Button>
                      </Link>
                      <Link href="/pricing" onClick={() => trackCTA("hero", "view_pricing", "Pricing")} className="text-xs text-white/60 underline underline-offset-4 hover:text-white">
                        Pricing
                      </Link>
                    </div>
                    <details className="mt-3 text-xs text-white/55" onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open) track("offer_terms_expand", { location: "hero" }); }}>
                      <summary className="cursor-pointer text-white/70 hover:text-white" data-testid="button-offer-terms">Offer terms and credit details</summary>
                      <div className="mt-2 space-y-1.5 leading-relaxed">
                        <p>{FREE_OFFER_COPY.videoExample}</p>
                        <p>{FREE_OFFER_COPY.music}</p>
                        <p>{FREE_OFFER_COPY.trialExtras}</p>
                        <p>{FREE_OFFER_COPY.afterTrial}</p>
                        <p>{FREE_OFFER_COPY.credits}</p>
                        <p>{FREE_OFFER_COPY.paid}</p>
                      </div>
                    </details>
                  </div>
                )}

                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.6, duration: 1 }}
                  className="mt-12 flex flex-wrap items-center justify-center lg:justify-start gap-x-6 gap-y-2 text-sm text-white/40"
                >
                  <Link href="/soundtracks" className="hover:text-white transition-colors flex items-center gap-1.5">
                    <Music className="h-3.5 w-3.5" /> Generate Music
                  </Link>
                  <span>&middot;</span>
                  <Link href="/generate" className="hover:text-white transition-colors flex items-center gap-1.5">
                    <Mic2 className="h-3.5 w-3.5" /> Create Narration
                  </Link>
                  <span>&middot;</span>
                  <Link href="/gallery" className="hover:text-white transition-colors flex items-center gap-1.5">
                    <Play className="h-3.5 w-3.5" /> Browse Gallery
                  </Link>
                </motion.div>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.8, delay: 0.2 }}
                className="relative w-full max-w-[320px] lg:max-w-[360px] mx-auto lg:mx-0 shrink-0"
              >
                <div className="relative overflow-hidden rounded-[2.5rem] border border-white/10 bg-[#050505] shadow-[0_0_60px_rgba(255,255,255,0.05)] aspect-[9/16] ring-1 ring-white/5">
                  <video
                    src="/homepage-demo.mp4"
                    poster="/kling-showcase-poster.jpg"
                    className="h-full w-full object-cover"
                    playsInline
                    controls
                    preload="metadata"
                    data-testid="video-hero-demo"
                    onPlay={() => track("demo_video_play", { location: "hero", src: "homepage-demo" })}
                  />
                  <div className="absolute top-5 left-5 bg-black/60 backdrop-blur-md border border-white/10 rounded-full px-3 py-1.5 pointer-events-none">
                    <span className="text-[10px] font-bold tracking-wider text-white uppercase">Rendered in Kling</span>
                  </div>
                </div>
                <p className="mt-3 flex items-center justify-center gap-2 text-xs text-white/60">
                  <Volume2 className="h-4 w-4 text-primary" /> Press play and turn your sound on.
                </p>
                <p className="mt-1 text-center text-[11px] text-white/40">Example output made with AI generation. Results vary by prompt, model and settings.</p>
              </motion.div>
            </div>
          </div>
        </section>

        {/* The Stack Replacement */}
        <section className="py-20 relative z-10 border-b border-white/5 bg-black">
          <div className="container px-4 md:px-6 mx-auto max-w-6xl">
            <div className="grid lg:grid-cols-12 gap-12 items-center">
              <div className="lg:col-span-5">
                <h2 className="text-3xl md:text-5xl font-extrabold tracking-tight mb-6">
                  One starting plan. <br />
                  <span className="text-white/40">Shared balance.</span>
                </h2>
                <p className="text-lg text-white/60 leading-relaxed mb-8">
                  Creator releases used to require a patchwork of subscriptions for music, voiceover, images, video, captions, and editing. AIBeatSync brings the full workflow together.
                </p>
                <div className="flex items-start gap-4 text-sm font-medium text-white/80 p-5 rounded-2xl bg-white/5 border border-white/10">
                  <CreditCard className="h-6 w-6 text-primary shrink-0" />
                  <p className="leading-relaxed">Your single credit balance powers music, narration, images, premium video rendering, and release-ready exports.</p>
                </div>
              </div>
              
               <div className="lg:col-span-7 grid sm:grid-cols-2 gap-4">
                {[
                  { title: "Premium Video", desc: "Kling & Runway generation.", icon: Clapperboard, color: "text-accent", bg: "bg-accent/10", border: "border-accent/20" },
                  { title: "Audio & Vocals", desc: "Generate tracks & instrumentals.", icon: Music, color: "text-primary", bg: "bg-primary/10", border: "border-primary/20" },
                   { title: "Narration Studio", desc: "Turn scripts into mixed, video-ready voiceovers.", icon: Mic2, color: "text-cyan-400", bg: "bg-cyan-500/10", border: "border-cyan-500/20" },
                  { title: "Visual Control", desc: "Storyboard before animating.", icon: Eye, color: "text-pink-400", bg: "bg-pink-500/10", border: "border-pink-500/20" },
                  { title: "Timeline Editor", desc: "Trim and export up to 1080p.", icon: Scissors, color: "text-white", bg: "bg-white/10", border: "border-white/20" }
                ].map((item, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 15 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.4, delay: i * 0.1 }}
                    className="bg-[#07070A] border border-white/10 rounded-3xl p-6 hover:border-white/20 transition-colors shadow-xl"
                  >
                    <div className={`h-12 w-12 rounded-2xl ${item.bg} border ${item.border} flex items-center justify-center mb-5`}>
                      <item.icon className={`h-6 w-6 ${item.color}`} />
                    </div>
                    <h3 className="text-xl font-bold text-white mb-2">{item.title}</h3>
                    <p className="text-white/50 text-sm leading-relaxed">{item.desc}</p>
                  </motion.div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Differentiator: Visual Approval */}
        <section className="py-24 relative overflow-hidden bg-[#030303]">
          <div className="absolute top-1/2 left-0 -translate-y-1/2 w-[600px] h-[600px] bg-primary/10 rounded-full blur-[150px] pointer-events-none" />

          <div className="container px-4 md:px-6 mx-auto max-w-6xl relative z-10">
            <div className="grid lg:grid-cols-2 gap-16 items-center">
              <motion.div
                initial={{ opacity: 0, x: -30 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6 }}
              >
                <div className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-sm font-medium text-primary mb-6">
                  <Lock className="mr-2 h-4 w-4" /> Save your credits
                </div>
                <h2 className="text-4xl md:text-5xl font-extrabold tracking-tight mb-6 leading-tight">
                  Visual approval <br />
                  <span className="text-white/40">before animation.</span>
                </h2>
                <p className="text-lg text-white/60 mb-8 leading-relaxed">
                  Blindly generating video wastes your balance. We pause the process so you can review the storyboard. Approve the images, regenerate the ones that miss the mark, and animate only the scenes you are happy with.
                </p>

                <ul className="space-y-4 mb-10">
                  {[
                    "Review every scene's foundation image",
                    "Use reference images to help keep characters more consistent",
                    "Check the scene order before you spend video credits",
                    "Animate only the scenes you approve"
                  ].map((item, i) => (
                    <li key={i} className="flex items-center gap-3 text-white/80">
                      <CheckCircle2 className="h-5 w-5 text-primary shrink-0" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>

                <Link href={isAuthenticated ? "/generate" : buildAuthUrl("/register", { returnTo: "/generate" })} onClick={() => trackCTA("approval_section", "open_generate_video", "Try Narrative Video")}>
                  <Button className="h-12 px-6 bg-gradient-electric text-white border-0 shadow-glow rounded-full group">
                    Try Narrative Video
                    <ArrowRight className="ml-2 h-4 w-4 group-hover:translate-x-1 transition-transform" />
                  </Button>
                </Link>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.8 }}
                className="relative min-h-[430px] md:h-[600px] rounded-3xl border border-white/10 bg-black/50 p-3 sm:p-5 md:p-6 flex flex-col justify-center overflow-hidden shadow-2xl"
              >
                <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff05_1px,transparent_1px),linear-gradient(to_bottom,#ffffff05_1px,transparent_1px)] bg-[size:24px_24px]" />

                <div className="relative z-10 space-y-6">
                  <div className="rounded-xl border border-white/10 bg-[#07070a] shadow-xl overflow-hidden md:transform md:-rotate-2 md:hover:rotate-0 transition-transform duration-500">
                    <div className="flex items-center justify-between gap-2 border-b border-white/10 bg-white/5 px-3 sm:px-4 py-3">
                      <span className="text-xs sm:text-sm font-semibold whitespace-nowrap">1. Visual Blueprint</span>
                      <span className="rounded-full bg-primary/20 px-2 py-0.5 text-[10px] text-primary uppercase tracking-wider">Pending Approval</span>
                    </div>
                    <img src="/narrative-gen-preview.png" alt="Storyboard preview" className="w-full h-[150px] sm:h-[180px] md:h-[190px] object-cover object-top opacity-80 hover:opacity-100 transition-opacity" />
                  </div>

                  <div className="rounded-xl border border-white/10 bg-[#07070a] shadow-xl overflow-hidden md:transform md:translate-x-8 md:rotate-1 md:hover:rotate-0 transition-transform duration-500 md:max-w-[calc(100%-2rem)]">
                     <div className="flex items-center justify-between gap-2 border-b border-white/10 bg-white/5 px-3 sm:px-4 py-3">
                      <span className="text-xs sm:text-sm font-semibold whitespace-nowrap">2. Final Render</span>
                      <span className="rounded-full bg-accent/20 px-2 py-0.5 text-[10px] text-accent uppercase tracking-wider">Processing</span>
                    </div>
                    <img src="/narrative-gen-processing.png" alt="Render processing" className="w-full h-[150px] sm:h-[180px] md:h-[190px] object-cover object-top opacity-80 hover:opacity-100 transition-opacity" />
                  </div>
                </div>
              </motion.div>
            </div>
          </div>
        </section>

        {/* Photo Animation Showcase */}
        <PhotoAnimationShowcase />

        {/* Premium Models Showcase */}
        <section className="py-24 border-y border-white/5 bg-black">
          <div className="container px-4 md:px-6 mx-auto max-w-6xl">
            <div className="grid lg:grid-cols-2 gap-16 items-center">
              
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6 }}
                className="lg:col-span-2"
              >
                <div className="mb-6 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs font-semibold text-white/80">
                  <Layers className="h-4 w-4 text-accent" />
                  Premium Engine Access
                </div>
                <h2 className="text-4xl md:text-5xl font-extrabold tracking-tight mb-6">
                  Kling & Runway. <br />
                  <span className="text-white/40">Visual excellence.</span>
                </h2>
                <p className="text-lg text-white/60 mb-8 leading-relaxed max-w-2xl">
                  Use premium generative video models inside the same workflow as your music, storyboard, lyrics, and final edit.
                </p>
                
                <div className="grid md:grid-cols-2 gap-4 mb-8 max-w-4xl">
                  <div className="bg-white/[0.03] border border-white/5 rounded-2xl p-5 flex items-start gap-4">
                    <Sparkles className="h-6 w-6 text-accent shrink-0 mt-0.5" />
                    <div>
                      <h4 className="text-white font-bold mb-1">Kling Engine</h4>
                      <p className="text-sm text-white/60">Cinematic motion built for narrative scenes, performances, and character-led storytelling.</p>
                    </div>
                  </div>
                  <div className="bg-white/[0.03] border border-white/5 rounded-2xl p-5 flex items-start gap-4">
                    <Activity className="h-6 w-6 text-primary shrink-0 mt-0.5" />
                    <div>
                      <h4 className="text-white font-bold mb-1">Runway</h4>
                      <p className="text-sm text-white/60">A premium generation option for dynamic sequences, stylized motion, and visual experimentation.</p>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 text-xs text-white/40 bg-white/5 p-4 rounded-xl border border-white/10 max-w-4xl">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <p>Model availability can vary. Keep your entire creative workflow in one place.</p>
                </div>
              </motion.div>

            </div>
          </div>
        </section>

        {/* Features Grid */}
        <section className="py-24 bg-[#050505]">
          <div className="container px-4 md:px-6 mx-auto max-w-6xl">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-5xl font-extrabold tracking-tight mb-6">
                Everything you need to <span className="text-white/40">tell the whole story.</span>
              </h2>
              <p className="text-lg text-white/60 max-w-2xl mx-auto">
                No jumping between tabs. Generate, edit and export in one place.
              </p>
            </div>

            <div className="grid gap-8 md:grid-cols-3">
              {/* Group 1: Control */}
              <div className="bg-white/[0.02] border border-white/5 rounded-3xl p-8 hover:bg-white/[0.04] transition-colors">
                <div className="flex items-center gap-4 border-b border-white/10 pb-6 mb-6">
                  <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center border border-primary/20">
                    <Lock className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="text-xl font-bold text-white">Precision Control</h3>
                </div>
                <div className="space-y-6">
                  <div>
                    <h4 className="text-white font-semibold mb-2">Visual Approval</h4>
                    <p className="text-sm text-white/50 leading-relaxed">Review foundation images before animating so you only spend video credits on scenes you approve.</p>
                  </div>
                  <div>
                    <h4 className="text-white font-semibold mb-2">Reference Images</h4>
                    <p className="text-sm text-white/50 leading-relaxed">Add a reference image to help characters look more consistent across clips. Results can still vary between scenes.</p>
                  </div>
                  <div>
                    <h4 className="text-white font-semibold mb-2">Prompt Studio</h4>
                    <p className="text-sm text-white/50 leading-relaxed">Describe a vibe in plain words and generate a polished video prompt.</p>
                  </div>
                </div>
              </div>

              {/* Group 2: Audio & Lyrics */}
              <div className="bg-white/[0.02] border border-white/5 rounded-3xl p-8 hover:bg-white/[0.04] transition-colors">
                <div className="flex items-center gap-4 border-b border-white/10 pb-6 mb-6">
                  <div className="h-12 w-12 rounded-2xl bg-accent/10 flex items-center justify-center border border-accent/20">
                    <Music className="h-6 w-6 text-accent" />
                  </div>
                  <h3 className="text-xl font-bold text-white">Audio & Lyrics</h3>
                </div>
                <div className="space-y-6">
                  <div>
                    <h4 className="text-white font-semibold mb-2">Auto-Sync Karaoke</h4>
                    <p className="text-sm text-white/50 leading-relaxed">Burn glowing, beat-synced captions directly into your video automatically.</p>
                  </div>
                  <div>
                    <h4 className="text-white font-semibold mb-2">Original Tracks</h4>
                    <p className="text-sm text-white/50 leading-relaxed">Generate instrumentals and drop them straight into your timeline.</p>
                  </div>
                  <div>
                     <h4 className="text-white font-semibold mb-2">Narration & Music Beds</h4>
                     <p className="text-sm text-white/50 leading-relaxed">Turn a script into narration, then use generated music, My Music, an upload, a Suno track, or no music.</p>
                  </div>
                </div>
              </div>

              {/* Group 3: Post-Production */}
              <div className="bg-white/[0.02] border border-white/5 rounded-3xl p-8 hover:bg-white/[0.04] transition-colors">
                <div className="flex items-center gap-4 border-b border-white/10 pb-6 mb-6">
                  <div className="h-12 w-12 rounded-2xl bg-pink-500/10 flex items-center justify-center border border-pink-500/20">
                    <Scissors className="h-6 w-6 text-pink-400" />
                  </div>
                  <h3 className="text-xl font-bold text-white">Post-Production</h3>
                </div>
                <div className="space-y-6">
                  <div>
                    <h4 className="text-white font-semibold mb-2">Creator Studio</h4>
                    <p className="text-sm text-white/50 leading-relaxed">A built-in timeline editor to trim, transition, and finalize your own clips and photos. No AI generation required.</p>
                  </div>
                  <div>
                    <h4 className="text-white font-semibold mb-2">1080p Exports, 30-Minute Timelines</h4>
                    <p className="text-sm text-white/50 leading-relaxed">Creator Studio exports at up to 1080p with timelines up to 30 minutes, including commentary overlays and text cards. The 30-minute limit is for Creator Studio only; AI video generation keeps its own separate length limits.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="creators-and-podcasters" aria-labelledby="creator-heading" className="border-y border-white/5 bg-primary/5 py-16 md:py-20">
          <div className="container mx-auto max-w-5xl px-4">
            <p className="mb-4 flex items-center gap-2 text-sm font-semibold text-primary">
              <Mic2 className="h-5 w-5" aria-hidden="true" />
              For content creators &amp; podcasters
            </p>
            <h2 id="creator-heading" className="max-w-3xl text-3xl font-bold tracking-tight text-white md:text-4xl">
              Layer videos, images, and commentary—right on cue
            </h2>
            <p className="mt-6 max-w-3xl text-lg leading-relaxed text-white/70">
              Build reaction videos, video-podcast episodes, and commentary content in Creator Studio.
              Add multiple video clips, static images, and text cards over your main video.
              Give each overlay its own start time and duration—for reactions, screenshots, product
              photos, and supporting visuals that appear exactly when you need them.
              Your time slots stay saved with the project and carry through to the final 1080p export.
            </p>
            <ul className="mt-6 flex flex-wrap gap-3 text-sm font-medium text-white/90" aria-label="Overlay features">
              {["Video + image overlays", "Individual start times & durations", "Up to 4 overlays on screen", "Saved timing in every export"].map((feature) => (
                <li key={feature} className="rounded-full border border-primary/30 bg-primary/10 px-4 py-2">{feature}</li>
              ))}
            </ul>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href={isAuthenticated ? "/editor?guide=commentary" : buildAuthUrl("/register", { returnTo: "/editor?guide=commentary" })}
                onClick={() => trackCTA("creators_podcasters", "start_commentary", "Start a commentary video")}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-primary px-6 py-3 font-semibold text-primary-foreground transition-opacity hover:opacity-90"
                data-testid="link-start-commentary"
              >
                Start a commentary video <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link
                href="/tutorial/script-to-video#commentary-overlays"
                onClick={() => trackCTA("creators_podcasters", "view_commentary_walkthrough", "See the walkthrough")}
                className="inline-flex min-h-12 items-center justify-center rounded-lg border border-white/20 px-6 py-3 font-semibold text-white transition-colors hover:bg-white/5"
                data-testid="link-commentary-walkthrough"
              >
                See the walkthrough
              </Link>
            </div>
            <p className="mt-4 text-sm text-white/50">
              The 30-minute limit applies to Creator Studio only. AI video generation has separate limits.
            </p>
          </div>
        </section>

        {/* Karaoke Spotlight */}
        <section className="py-24 border-t border-white/5 relative overflow-hidden bg-black">
          <div className="absolute inset-0 bg-gradient-to-br from-pink-500/10 via-transparent to-primary/10 pointer-events-none z-0" />
          <div className="container px-4 md:px-6 mx-auto max-w-6xl relative z-10">
            <div className="grid md:grid-cols-2 gap-16 items-center">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6 }}
              >
                <div className="inline-flex items-center rounded-full border border-pink-500/30 bg-pink-500/10 px-4 py-1.5 text-sm font-medium text-pink-400 mb-6">
                  <Mic2 className="mr-2 h-4 w-4" /> Karaoke Mode
                </div>
                <h2 className="text-4xl md:text-5xl font-extrabold tracking-tight mb-6">
                  Make videos you can <br />
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-pink-400 to-primary">sing along to.</span>
                </h2>
                <p className="text-white/60 text-lg leading-relaxed mb-8">
                  Turn any track into a karaoke lyric video. Type or paste your lyrics — or let Auto-sync listen to your song and time every line for you — and we burn glowing, beat-synced captions straight into the video.
                </p>
                <ul className="space-y-4 mb-10 text-white/80">
                  {[
                    "Paste plain lyrics or LRC files",
                    "Auto-sync times every line to the vocal automatically",
                    "Works on new videos or ones you've already made"
                  ].map((line, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <Sparkles className="h-5 w-5 text-pink-400 shrink-0" />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap gap-4">
                  <Link href={isAuthenticated ? "/generate" : buildAuthUrl("/register", { returnTo: "/generate" })} onClick={() => trackCTA("karaoke", "open_generate_video", "Make a karaoke video")}>
                    <Button size="lg" className="h-14 px-8 bg-gradient-to-r from-pink-500 to-primary text-white border-0 shadow-glow rounded-full">
                      <Mic2 className="mr-2 h-5 w-5" /> Make a karaoke video
                    </Button>
                  </Link>
                  <Link href="/ai-lyric-video" onClick={() => trackCTA("karaoke", "view_lyric_guide", "How lyric videos work")}>
                    <Button size="lg" variant="outline" className="h-14 px-8 border-pink-500/30 hover:bg-pink-500/10 hover:text-pink-400 rounded-full bg-transparent text-white">
                      How it works
                    </Button>
                  </Link>
                </div>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.8 }}
                className="relative rounded-3xl border border-white/10 bg-black overflow-hidden shadow-2xl aspect-video ring-1 ring-white/5"
              >
                <div className="absolute inset-0 bg-gradient-to-br from-primary/30 via-purple-900/50 to-pink-500/30" />
                <div className="absolute inset-0 flex flex-col items-center justify-end pb-12 px-8 text-center gap-3 z-10">
                  <p className="text-white/40 text-lg md:text-xl font-semibold">city lights are calling out my name</p>
                  <p className="text-white text-3xl md:text-4xl font-extrabold tracking-tight drop-shadow-[0_0_20px_rgba(236,72,153,0.9)]">
                    tonight we're singing in the rain
                  </p>
                  <p className="text-white/20 text-lg md:text-xl font-semibold">and nothing's gonna stop us now</p>
                </div>
              </motion.div>
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="py-32 border-t border-white/5 bg-[#030303] text-center relative overflow-hidden">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-primary/10 rounded-full blur-[150px] pointer-events-none" />

          <div className="container relative z-10 px-4 max-w-3xl mx-auto">
            <h2 className="text-5xl md:text-6xl font-extrabold tracking-tight mb-8">
              Ready for your next release?
            </h2>
            <p className="text-xl text-white/50 mb-12">
              Generate new AI visuals with credits, or edit your own footage in Creator Studio.
            </p>
            <p className="text-sm text-white/60 mb-4">
              <Link href="/whats-new" className="underline underline-offset-4 hover:text-white" data-testid="link-home-whats-new">What's new (November 9, 2026): commentary and reaction overlays in Creator Studio</Link>
            </p>
            <p className="text-sm text-white/60 mb-6">{FREE_OFFER_COPY.short} {FREE_OFFER_COPY.example} {FREE_OFFER_COPY.expiry} {FREE_OFFER_COPY.credits}</p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-5">
              <Link href={isAuthenticated ? "/editor" : buildAuthUrl("/register", { returnTo: "/editor" })} onClick={() => trackCTA("footer", "open_montage_studio", "Open Creator Studio")}>
                <Button size="lg" className="w-full sm:w-auto text-lg h-14 px-10 bg-white text-black hover:bg-white/90 rounded-full font-semibold">
                  Open Creator Studio
                </Button>
              </Link>
              <Link href="/pricing" onClick={() => trackCTA("footer", "view_pricing", "View pricing plans")}>
                <Button size="lg" variant="outline" className="w-full sm:w-auto text-lg h-14 px-10 border-white/20 hover:bg-white/10 rounded-full bg-transparent text-white">
                  View pricing plans
                </Button>
              </Link>
            </div>
          </div>
        </section>

      </main>
    </div>
  );
}
