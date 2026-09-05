import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { track } from "@/lib/analytics";
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
  Maximize,
  VideoOff,
  Mic2,
  Eye,
  CheckCircle2
} from "lucide-react";
import { motion } from "framer-motion";
import { AuroraBackground } from "@/components/AuroraBackground";

export default function Home() {
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
          
          <div className="container relative z-10 px-4 md:px-6 mx-auto text-center max-w-5xl pt-20">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: "easeOut" }}
              className="flex flex-col items-center"
            >
              <div className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-sm font-medium text-white/80 mb-8 backdrop-blur-md">
                <Sparkles className="mr-2 h-4 w-4 text-primary" />
                The professional AI studio for musicians
              </div>

              <h1 className="text-5xl sm:text-6xl md:text-8xl font-extrabold tracking-tighter mb-8 leading-[1.1]">
                One track. <br className="hidden sm:block" />
                One <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-accent">complete release.</span>
              </h1>

              <p className="text-lg md:text-2xl text-white/60 mb-12 max-w-3xl mx-auto font-light leading-relaxed">
                Most tools generate a random clip. AIBeatSync gives you the director's chair. Generate visuals, approve every frame before animation, and finish your cut in <span className="text-white font-medium">Montage Studio</span>.
              </p>

              <div className="flex flex-col sm:flex-row items-center justify-center gap-5 w-full sm:w-auto">
                <Link href="/generate" onClick={() => trackCTA("hero", "open_generate_video", "Create my music video")}>
                  <Button size="lg" className="w-full sm:w-auto text-lg h-14 px-8 bg-white text-black hover:bg-white/90 shadow-[0_0_40px_rgba(255,255,255,0.2)] border-0 transition-all group rounded-full">
                    <Wand2 className="mr-2 h-5 w-5 transition-transform group-hover:rotate-12" />
                    Create my music video
                  </Button>
                </Link>
                <Link href="/editor" onClick={() => trackCTA("hero", "open_montage_studio", "Open Montage Studio — free")}>
                  <Button size="lg" variant="outline" className="w-full sm:w-auto text-lg h-14 px-8 border-white/10 bg-white/5 hover:bg-white/10 hover:text-white backdrop-blur-md transition-all group rounded-full text-white/90">
                    <Scissors className="mr-2 h-5 w-5 transition-transform group-hover:-rotate-12" />
                    Open Montage Studio — free
                  </Button>
                </Link>
              </div>

              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.6, duration: 1 }}
                className="mt-16 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-white/40"
              >
                <Link href="/soundtracks" className="hover:text-white transition-colors flex items-center gap-1.5">
                  <Music className="h-3.5 w-3.5" /> Generate Soundtracks
                </Link>
                <span>&middot;</span>
                <Link href="/gallery" className="hover:text-white transition-colors flex items-center gap-1.5">
                  <Play className="h-3.5 w-3.5" /> Browse Gallery
                </Link>
                <span>&middot;</span>
                <Link href="/dashboard" className="hover:text-white transition-colors flex items-center gap-1.5">
                  <Share2 className="h-3.5 w-3.5" /> Refer & Earn
                </Link>
              </motion.div>
            </motion.div>
          </div>
        </section>

        {/* Workflow Section */}
        <section className="py-24 relative z-10 border-b border-white/5 bg-black">
          <div className="container px-4 md:px-6 mx-auto max-w-6xl">
            <div className="text-center mb-20">
              <h2 className="text-3xl md:text-5xl font-extrabold tracking-tight mb-6">
                The complete journey. <span className="text-white/40">In one place.</span>
              </h2>
              <p className="text-lg text-white/60 max-w-2xl mx-auto">
                No switching between five different apps. AIBeatSync connects the entire music video pipeline from the first beat to the final social export.
              </p>
            </div>

            <div className="grid md:grid-cols-4 gap-6">
              {[
                { icon: Music, title: "1. The Track", desc: "Upload your song, paste a link, or generate an original vocal track or instrumental in seconds." },
                { icon: Eye, title: "2. The Storyboard", desc: "Describe your vision and generate the base images. You control the aesthetic." },
                { icon: CheckCircle2, title: "3. The Approval", desc: "Review and approve every frame. Nothing animates until you're completely satisfied." },
                { icon: Scissors, title: "4. The Final Cut", desc: "Bring the renders into Montage Studio. Trim, sync, and export in crisp 1080p." }
              ].map((step, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-100px" }}
                  transition={{ duration: 0.5, delay: i * 0.1 }}
                  className="bg-white/[0.02] border border-white/5 rounded-3xl p-8 hover:bg-white/[0.04] transition-colors relative group overflow-hidden"
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-primary/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                  <div className="h-12 w-12 rounded-2xl bg-white/10 flex items-center justify-center mb-6 border border-white/10 relative z-10 group-hover:scale-110 transition-transform">
                    <step.icon className="h-6 w-6 text-white" />
                  </div>
                  <h3 className="text-xl font-bold mb-3 text-white relative z-10">{step.title}</h3>
                  <p className="text-white/50 leading-relaxed relative z-10">{step.desc}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* Differentiator: Visual Approval */}
        <section className="py-24 relative overflow-hidden bg-[#050505]">
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
                  <Lock className="mr-2 h-4 w-4" /> Keep control at the gate
                </div>
                <h2 className="text-4xl md:text-5xl font-extrabold tracking-tight mb-6 leading-tight">
                  Visual approval <br />
                  <span className="text-white/40">before animation.</span>
                </h2>
                <p className="text-lg text-white/60 mb-8 leading-relaxed">
                  Blindly generating video is a waste of credits and time. We pause the process so you can review the storyboard. Approve the images, regenerate the ones that miss the mark, and animate only when the vision is perfect.
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
                className="relative h-[600px] rounded-3xl border border-white/10 bg-black/50 p-6 flex flex-col justify-center overflow-hidden shadow-2xl"
              >
                <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff05_1px,transparent_1px),linear-gradient(to_bottom,#ffffff05_1px,transparent_1px)] bg-[size:24px_24px]" />

                <div className="relative z-10 space-y-6">
                  <div className="rounded-xl border border-white/10 bg-[#07070a] shadow-xl overflow-hidden transform -rotate-2 hover:rotate-0 transition-transform duration-500">
                    <div className="flex items-center justify-between border-b border-white/10 bg-white/5 px-4 py-3">
                      <span className="text-sm font-semibold">1. Visual Blueprint</span>
                      <span className="rounded-full bg-primary/20 px-2 py-0.5 text-[10px] text-primary">Pending Approval</span>
                    </div>
                    <img src="/narrative-gen-preview.png" alt="Storyboard preview" className="w-full h-auto opacity-80 hover:opacity-100 transition-opacity" />
                  </div>

                  <div className="rounded-xl border border-white/10 bg-[#07070a] shadow-xl overflow-hidden transform translate-x-8 rotate-1 hover:rotate-0 transition-transform duration-500">
                     <div className="flex items-center justify-between border-b border-white/10 bg-white/5 px-4 py-3">
                      <span className="text-sm font-semibold">2. Final Render</span>
                      <span className="rounded-full bg-accent/20 px-2 py-0.5 text-[10px] text-accent">Processing</span>
                    </div>
                    <img src="/narrative-gen-processing.png" alt="Render processing" className="w-full h-auto opacity-80 hover:opacity-100 transition-opacity" />
                  </div>
                </div>
              </motion.div>
            </div>
          </div>
        </section>

        {/* Kling Vertical Showcase */}
        <section className="py-24 border-y border-white/5 bg-black">
          <div className="container px-4 md:px-6 mx-auto max-w-5xl">
            <div className="grid md:grid-cols-2 gap-16 items-center">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6 }}
                className="order-2 md:order-1 mx-auto w-full max-w-[320px]"
              >
                <div className="relative overflow-hidden rounded-[2.5rem] border border-white/10 bg-[#050505] shadow-[0_0_60px_rgba(255,255,255,0.05)] aspect-[9/16] ring-1 ring-white/5">
                  <video
                    src="/kling-showcase.mp4"
                    poster="/kling-showcase-poster.jpg"
                    className="h-full w-full object-cover"
                    autoPlay
                    muted
                    loop
                    playsInline
                    controls
                    preload="metadata"
                  />
                </div>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, x: 20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6 }}
                className="order-1 md:order-2"
              >
                <div className="mb-6 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs font-semibold text-white/80">
                  <Sparkles className="h-4 w-4 text-accent" />
                  Powered by Kling Engine
                </div>
                <h2 className="text-4xl md:text-5xl font-extrabold tracking-tight mb-6">
                  Pure cinema. <br />
                  <span className="text-white/40">Zero cameras.</span>
                </h2>
                <p className="text-lg text-white/60 mb-8 leading-relaxed">
                  This 45-second vertical film was generated by AIBeatSync with the Kling engine and an AI-composed soundtrack. No footage, no complex editing software — just a track and a prompt.
                </p>
                <Link href="/generate" onClick={() => trackCTA("showcase", "open_generate_video", "Create your own")}>
                  <Button size="lg" className="h-14 px-8 bg-white text-black hover:bg-white/90 rounded-full font-semibold transition-all hover:scale-105">
                    <Play className="mr-2 h-5 w-5" />
                    Create your own
                  </Button>
                </Link>
              </motion.div>
            </div>
          </div>
        </section>

        {/* Features Grid */}
        <section className="py-24 bg-[#050505]">
          <div className="container px-4 md:px-6 mx-auto max-w-6xl">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-5xl font-extrabold tracking-tight mb-6">
                The details one-trick tools <span className="text-white/40">can't match.</span>
              </h2>
              <p className="text-lg text-white/60 max-w-2xl mx-auto">
                Everything you need to turn a raw idea into a polished release.
              </p>
            </div>

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {[
                { icon: Lock, title: "Character Lock", body: "Lock a face or look from a reference image so the same character carries across every clip — no shape-shifting." },
                { icon: Clapperboard, title: "Gen Preview", body: "Generate images first and pause before animation. Review every scene, then approve the video." },
                { icon: Share2, title: "Release Kit", body: "One click turns your finished video into a full set of social exports — vertical, square, and Spotify Canvas." },
                { icon: Mic2, title: "Karaoke Lyric Videos", body: "Type or paste your lyrics and we burn glowing, beat-synced karaoke captions right into the video." },
                { icon: Wand2, title: "Prompt Studio", body: "Describe a vibe in plain words and get a polished video prompt or full, original lyrics in seconds." },
                { icon: Maximize, title: "Up to 4K & 10 Minutes", body: "Go beyond quick clips: render crisp 4K and full-length videos up to ten minutes for premium releases." },
                { icon: VideoOff, title: "Score It Later", body: "Render visuals with no soundtrack, then add the perfect track later in Montage Studio." },
                { icon: Music, title: "Royalty-Free Soundtracks", body: "Generate original instrumentals you fully own and drop them straight into your video timeline." },
                { icon: Scissors, title: "Montage Studio", body: "A built-in editor to trim, transition, and finalize your masterpiece without ever leaving the platform." }
              ].map((f, i) => (
                <motion.div
                  key={f.title}
                  initial={{ opacity: 0, y: 15 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-50px" }}
                  transition={{ duration: 0.4, delay: (i % 3) * 0.1 }}
                  className="rounded-3xl border border-white/5 bg-white/[0.02] p-8 hover:bg-white/[0.04] transition-colors group"
                >
                  <div className="h-12 w-12 rounded-2xl bg-white/5 flex items-center justify-center mb-6 group-hover:bg-primary/20 transition-colors">
                    <f.icon className="h-6 w-6 text-white group-hover:text-primary transition-colors" />
                  </div>
                  <h3 className="text-xl font-bold mb-3 text-white">{f.title}</h3>
                  <p className="text-white/50 leading-relaxed">{f.body}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* Karaoke Spotlight */}
        <section className="py-24 border-t border-white/5 relative overflow-hidden bg-black">
          <div className="absolute inset-0 bg-gradient-to-br from-pink-500/10 via-transparent to-primary/10 pointer-events-none" />
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
                <div className="absolute inset-0 flex flex-col items-center justify-end pb-12 px-8 text-center gap-3">
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
              Join the independent artists using AIBeatSync to direct and publish high-fidelity music videos.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-5">
              <Link href="/editor" onClick={() => trackCTA("footer", "open_montage_studio", "Open Montage Studio")}>
                <Button size="lg" className="w-full sm:w-auto text-lg h-14 px-10 bg-white text-black hover:bg-white/90 rounded-full font-semibold">
                  Open Montage Studio
                </Button>
              </Link>
              <Link href="/generate" onClick={() => trackCTA("footer", "open_generate_video", "Generate Video")}>
                <Button size="lg" variant="outline" className="w-full sm:w-auto text-lg h-14 px-10 border-white/20 hover:bg-white/10 rounded-full bg-transparent text-white">
                  Generate Video
                </Button>
              </Link>
            </div>
          </div>
        </section>

      </main>
    </div>
  );
}
