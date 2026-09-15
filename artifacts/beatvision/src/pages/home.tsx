import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { track } from "@/lib/analytics";
import { useAuth } from "@/hooks/useAuth";
import {
  ArrowRight,
  Play,
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
  Film,
  AudioWaveform
} from "lucide-react";
import { motion } from "framer-motion";
import { AuroraBackground } from "@/components/AuroraBackground";

import { useSEO } from "@/hooks/useSEO";

export default function Home() {
  useSEO({
    title: "AI Studio for Music and Video",
    description: "Turn your audio into visual stories with AIBeatSync. Start a 7-day registration trial for free instrumentals and unlimited clean Montage exports.",
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
        "description": "Start a 7-day registration trial with zero starting credits, excluding valid referral or promotional grants. Enjoy 3 lifetime free instrumentals and 1 free vocal song. Both trial and paid users get unlimited clean Montage exports. During the trial, receive 3 free lyric-burn exports and 3 free auto-sync aligns. After the trial, non-paid users can export 10 free videos per calendar month."
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
                  The AI studio for musicians and storytellers
                </div>

                <h1 className="text-4xl sm:text-5xl md:text-7xl font-extrabold tracking-tighter mb-6 leading-[1.1]">
                  Turn your audio <br className="hidden sm:block" />
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-accent">into visual stories.</span>
                </h1>

                <p className="text-base sm:text-lg md:text-xl text-white/60 mb-8 max-w-xl lg:mx-0 font-light leading-relaxed">
                  Create music videos and short narrated stories. Generate visuals, sync lyrics, and edit the final cut—all from one site and one shared credit balance.
                </p>

                <div className="flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-4 w-full sm:w-auto">
                  <Link
                    href={isAuthenticated ? "/generate" : "/register"}
                    onClick={() => trackCTA("hero", isAuthenticated ? "open_generate_video" : "open_signup", isAuthenticated ? "Create a music video" : "Create your first music video")}
                    className="w-full sm:w-auto"
                  >
                    <Button size="lg" className="w-full sm:w-auto text-base sm:text-lg h-12 sm:h-14 px-6 sm:px-8 bg-white text-black hover:bg-white/90 shadow-[0_0_40px_rgba(255,255,255,0.2)] border-0 transition-all group rounded-full">
                      <Wand2 className="mr-2 h-5 w-5" />
                      {isAuthenticated ? "Create a music video" : "Create your first music video"}
                    </Button>
                  </Link>
                  <Link href="/pricing" onClick={() => trackCTA("hero", "view_pricing", "View Pricing")} className="w-full sm:w-auto">
                    <Button size="lg" variant="outline" className="w-full sm:w-auto text-base sm:text-lg h-12 sm:h-14 px-6 sm:px-8 border-white/10 bg-white/5 hover:bg-white/10 hover:text-white backdrop-blur-md transition-all group rounded-full text-white/90">
                      <Wallet className="mr-2 h-5 w-5" />
                      View Pricing
                    </Button>
                  </Link>
                </div>

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
                    src="/kling-showcase.mp4"
                    poster="/kling-showcase-poster.jpg"
                    className="h-full w-full object-cover"
                    playsInline
                    controls
                    preload="metadata"
                  />
                  <div className="absolute top-6 right-6 bg-black/60 backdrop-blur-md border border-white/10 rounded-full px-3 py-1.5 flex items-center gap-2 shadow-xl pointer-events-none">
                    <span className="text-[10px] font-bold tracking-wider text-white uppercase">Rendered in Kling</span>
                  </div>
                  <div className="absolute inset-x-4 bottom-4 rounded-2xl border border-white/15 bg-black/65 p-3 backdrop-blur-xl shadow-2xl pointer-events-none">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/20 text-primary">
                          <Film className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-[11px] font-semibold text-white">Cinematic Output</p>
                          <p className="text-[9px] uppercase tracking-[0.18em] text-white/45">High Quality Gen</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
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
                  { title: "Timeline Editor", desc: "Trim and export up to 4K.", icon: Scissors, color: "text-white", bg: "bg-white/10", border: "border-white/20" }
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
                  Blindly generating video wastes your balance. We pause the process so you can review the storyboard. Approve the images, regenerate the ones that miss the mark, and animate only when the vision is perfect.
                </p>

                <ul className="space-y-4 mb-10">
                  {[
                    "Review every scene's foundation image",
                    "Maintain consistent character looks",
                    "Guarantee the narrative flows correctly",
                    "Animate only the scenes you approve"
                  ].map((item, i) => (
                    <li key={i} className="flex items-center gap-3 text-white/80">
                      <CheckCircle2 className="h-5 w-5 text-primary shrink-0" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>

                <Link href="/generate" onClick={() => trackCTA("approval_section", "open_generate_video", "Try Narrative Video")}>
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
                No jumping between tabs. Every tool is integrated into one seamless workflow.
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
                    <p className="text-sm text-white/50 leading-relaxed">Review foundation images before animating to guarantee your aesthetic and save credits.</p>
                  </div>
                  <div>
                    <h4 className="text-white font-semibold mb-2">Character Lock</h4>
                    <p className="text-sm text-white/50 leading-relaxed">Lock a face or look from a reference image so characters remain consistent across clips.</p>
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
                    <h4 className="text-white font-semibold mb-2">Montage Studio</h4>
                    <p className="text-sm text-white/50 leading-relaxed">A built-in timeline editor to trim, transition, and finalize your masterpiece.</p>
                  </div>
                  <div>
                    <h4 className="text-white font-semibold mb-2">Up to 4K Quality</h4>
                    <p className="text-sm text-white/50 leading-relaxed">Go beyond quick clips: render crisp 4K and full-length videos up to ten minutes.</p>
                  </div>
                </div>
              </div>
            </div>
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
                  <Link href="/generate" onClick={() => trackCTA("karaoke", "open_generate_video", "Make a karaoke video")}>
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
              Join creators using AIBeatSync to produce music, narrated stories, cinematic videos, and social-ready releases.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-5">
              <Link href="/pricing" onClick={() => trackCTA("footer", "view_pricing", "View pricing plans")}>
                <Button size="lg" className="w-full sm:w-auto text-lg h-14 px-10 bg-white text-black hover:bg-white/90 rounded-full font-semibold">
                  View pricing plans
                </Button>
              </Link>
              <Link href="/editor" onClick={() => trackCTA("footer", "open_montage_studio", "Open Montage Studio")}>
                <Button size="lg" variant="outline" className="w-full sm:w-auto text-lg h-14 px-10 border-white/20 hover:bg-white/10 rounded-full bg-transparent text-white">
                  Open Montage Studio
                </Button>
              </Link>
            </div>
          </div>
        </section>

      </main>
    </div>
  );
}
