import { useState, useRef } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Play, Sparkles, Zap, Music, MonitorPlay, ExternalLink, ScanLine, ImagePlus, Volume2, VolumeX, Scissors, Lock, Clapperboard, Share2, Wand2, Maximize } from "lucide-react";
import { motion } from "framer-motion";
import { AuroraBackground } from "@/components/AuroraBackground";

const SAMPLES = [
  { src: "/sample1.mp4", label: "Cinematic" },
  { src: "/sample2.mp4", label: "Neon Glow" },
  { src: "/sample3.mp4", label: "Abstract" },
];

function SampleVideo({ src, label }: { src: string; label: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);
  const [playing, setPlaying] = useState(false);

  const toggle = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { v.play(); setPlaying(true); }
    else { v.pause(); setPlaying(false); }
  };

  const toggleMute = (e: React.MouseEvent) => {
    e.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5 }}
      className="group relative rounded-2xl overflow-hidden bg-black border border-white/10 cursor-pointer shadow-xl"
      style={{ aspectRatio: "16/9" }}
      onClick={toggle}
    >
      <video
        ref={videoRef}
        src={src}
        className="w-full h-full object-cover"
        loop
        muted
        playsInline
        autoPlay
        preload="auto"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      />
      {/* Overlay */}
      <div className={`absolute inset-0 bg-black/40 flex items-center justify-center transition-opacity duration-200 ${playing ? "opacity-0 group-hover:opacity-100" : "opacity-100"}`}>
        <div className="h-14 w-14 rounded-full bg-white/20 backdrop-blur-sm border border-white/30 flex items-center justify-center">
          <Play className="h-6 w-6 text-white fill-white ml-0.5" />
        </div>
      </div>
      {/* Label */}
      <div className="absolute bottom-3 left-3 px-2.5 py-1 rounded-full bg-black/60 backdrop-blur-sm text-xs font-semibold text-white/90 border border-white/15">
        {label}
      </div>
      {/* Mute toggle */}
      {playing && (
        <button
          onClick={toggleMute}
          className="absolute bottom-3 right-3 h-8 w-8 rounded-full bg-black/60 backdrop-blur-sm border border-white/15 flex items-center justify-center text-white/80 hover:text-white transition-colors"
        >
          {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
        </button>
      )}
    </motion.div>
  );
}

export default function Home() {
  return (
    <div className="flex flex-col min-h-[calc(100vh-4rem)]">
      <main className="flex-1">
        {/* Hero Section */}
        <section className="relative py-20 md:py-32 overflow-hidden flex items-center">
          {/* Abstract background elements */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-primary/20 rounded-full blur-[120px] pointer-events-none" />
          <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-accent/20 rounded-full blur-[100px] pointer-events-none" />
          <AuroraBackground />
          
          <div className="container px-4 md:px-6 relative z-10 mx-auto text-center max-w-5xl">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
            >
              <div className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-sm font-medium text-primary mb-6 backdrop-blur-sm">
                <Sparkles className="mr-2 h-4 w-4" />
                The all-in-one AI music-video studio
              </div>

              <h1 className="text-4xl sm:text-5xl md:text-7xl font-extrabold tracking-tight mb-6 leading-tight">
                From a track to a <br />
                <span className="text-gradient-electric">ready-to-post video</span>
              </h1>

              <p className="text-lg md:text-xl text-muted-foreground mb-10 max-w-2xl mx-auto">
                Most tools stop at a single clip. AI Beat Sync takes you the whole way — beat-synced AI visuals,
                consistent characters, a royalty-free soundtrack, and one-click social cuts. Bring a song or
                <span className="text-foreground font-semibold"> generate one</span>, then let AI direct it or take control in <span className="text-foreground font-semibold">Remix Lab</span>.
              </p>

              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Link href="/generate">
                  <Button size="lg" className="w-full sm:w-auto text-lg h-14 px-8 bg-gradient-electric text-white shadow-glow hover:opacity-90 border-0 transition-all group">
                    <Play className="mr-2 h-5 w-5 group-hover:scale-110 transition-transform" />
                    Generate with AI
                  </Button>
                </Link>
                <Link href="/editor">
                  <Button size="lg" variant="outline" className="w-full sm:w-auto text-lg h-14 px-8 border-accent/40 bg-secondary/50 hover:bg-accent/10 hover:text-accent hover:border-accent/60 backdrop-blur-sm transition-all group">
                    <Scissors className="mr-2 h-5 w-5 group-hover:scale-110 transition-transform" />
                    Open Remix Lab
                  </Button>
                </Link>
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
                <Link href="/soundtracks" className="text-sm text-primary underline underline-offset-4 hover:opacity-80">
                  create a royalty-free soundtrack
                </Link>
                <span className="text-sm text-muted-foreground">·</span>
                <Link href="/gallery" className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground">
                  browse the gallery
                </Link>
              </div>
            </motion.div>
          </div>
        </section>

        {/* The big picture — end-to-end differentiation */}
        <section className="py-16 border-t border-border/30">
          <div className="container px-4 md:px-6 mx-auto max-w-5xl text-center">
            <div className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-sm font-medium text-primary mb-5 backdrop-blur-sm">
              <Sparkles className="mr-2 h-3.5 w-3.5" /> One studio, the whole pipeline
            </div>
            <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight mb-4">
              Most tools do one step. <span className="text-gradient-electric">We do the whole song.</span>
            </h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto mb-10">
              A text-to-video app gives you a clip. A music app gives you a track. AI Beat Sync connects the
              whole chain — so you go from a song to a finished, on-brand music video without switching apps.
            </p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 text-left">
              {[
                { icon: Music, title: "1 · Bring or make music", body: "Upload a song, paste a Suno link, or generate a royalty-free Soundtrack in seconds." },
                { icon: Sparkles, title: "2 · AI beat-synced video", body: "The engine reads your track's beat, energy, and mood and renders cinematic, on-beat visuals." },
                { icon: Scissors, title: "3 · Make it yours", body: "Fine-tune on the Remix Lab timeline — trim clips, sync music, add transitions, preview live." },
                { icon: Share2, title: "4 · Export everywhere", body: "One-click Release Kit gives you TikTok, Reels, Shorts, and Spotify Canvas cuts, ready to post." },
              ].map((s) => (
                <div key={s.title} className="rounded-2xl border border-card-border bg-card p-6">
                  <div className="h-10 w-10 rounded-lg bg-primary/15 flex items-center justify-center mb-4">
                    <s.icon className="h-5 w-5 text-primary" />
                  </div>
                  <h3 className="font-bold mb-1.5">{s.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{s.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Featured Kling showcase — real AI-generated Short */}
        <section className="py-16 border-t border-border/30">
          <div className="container px-4 md:px-6 mx-auto max-w-5xl">
            <div className="grid items-center gap-8 md:grid-cols-2">
              <div className="mx-auto w-full max-w-[300px]">
                <div
                  className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-black shadow-2xl"
                  style={{ aspectRatio: "9 / 16" }}
                >
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
              </div>
              <div>
                <div className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                  <Sparkles className="h-3.5 w-3.5" />
                  Made with the Kling engine
                </div>
                <h2 className="mb-3 text-3xl font-extrabold tracking-tight md:text-4xl">
                  A cinematic Short — from a single prompt.
                </h2>
                <p className="mb-6 max-w-md text-lg text-muted-foreground">
                  This 45-second vertical film was generated by AI Beat Sync with the Kling engine and an
                  AI-composed soundtrack. No cameras, no footage, no editing — just a track and a prompt.
                </p>
                <Link href="/generate">
                  <Button size="lg" className="border-0 bg-gradient-electric text-white shadow-glow hover:opacity-90">
                    <Play className="mr-2 h-5 w-5" />
                    Create your own
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* Ways to create — video + soundtracks */}
        <section className="py-16 border-t border-border/30">
          <div className="container px-4 md:px-6 mx-auto max-w-6xl">
            <div className="text-center mb-10">
              <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight mb-3">Video <span className="text-gradient-electric">+</span> Soundtracks</h2>
              <p className="text-muted-foreground max-w-2xl mx-auto">
                Make beat-synced videos — let AI do it or take control on the timeline — and generate the
                royalty-free music to go with them, all in one place.
              </p>
            </div>
            <div className="grid md:grid-cols-3 gap-6">
              <div className="group rounded-2xl border border-card-border bg-card p-8 flex flex-col transition-all duration-300 hover:-translate-y-1 hover:border-primary/40 hover:shadow-glow">
                <div className="h-12 w-12 rounded-xl bg-primary/15 flex items-center justify-center mb-5 transition-transform group-hover:scale-110">
                  <Sparkles className="h-6 w-6 text-primary" />
                </div>
                <h3 className="text-xl font-bold mb-2">AI Generator</h3>
                <p className="text-muted-foreground mb-6 flex-1">
                  Upload a song and our AI analyzes its beat, energy, and mood to generate cinematic, beat-synced
                  visuals in 8 styles — automatically.
                </p>
                <Link href="/generate">
                  <Button className="bg-gradient-electric text-white border-0 shadow-glow hover:opacity-90">
                    Generate with AI
                  </Button>
                </Link>
              </div>
              <div className="group rounded-2xl border border-card-border bg-card p-8 flex flex-col transition-all duration-300 hover:-translate-y-1 hover:border-accent/40 hover:shadow-glow">
                <div className="h-12 w-12 rounded-xl bg-accent/15 flex items-center justify-center mb-5 transition-transform group-hover:scale-110">
                  <Scissors className="h-6 w-6 text-accent" />
                </div>
                <h3 className="text-xl font-bold mb-2">Remix Lab</h3>
                <p className="text-muted-foreground mb-4 flex-1">
                  Your own cut, your rules. Drop clips and photos onto a timeline, sync a music track, add smooth
                  transitions, preview live, and export a crisp <span className="text-foreground font-medium">1080p</span> MP4 — no watermark.
                </p>
                <div className="flex flex-wrap gap-2 mb-6">
                  {["1080p export", "No watermark", "Music sync", "Live preview"].map((chip) => (
                    <span
                      key={chip}
                      className="text-xs font-medium text-muted-foreground border border-border/60 rounded-full px-2.5 py-1 bg-secondary/40"
                    >
                      {chip}
                    </span>
                  ))}
                </div>
                <Link href="/editor">
                  <Button variant="outline" className="border-accent/40 hover:bg-accent/10 hover:text-accent">
                    Open Remix Lab
                  </Button>
                </Link>
              </div>
              <div className="group rounded-2xl border border-card-border bg-card p-8 flex flex-col transition-all duration-300 hover:-translate-y-1 hover:border-primary/40 hover:shadow-glow">
                <div className="h-12 w-12 rounded-xl bg-primary/15 flex items-center justify-center mb-5 transition-transform group-hover:scale-110">
                  <Music className="h-6 w-6 text-primary" />
                </div>
                <h3 className="text-xl font-bold mb-2">Soundtracks</h3>
                <p className="text-muted-foreground mb-4 flex-1">
                  No track yet? Generate royalty-free instrumentals in seconds, then drop them straight into a video.
                </p>
                <div className="flex flex-wrap gap-2 mb-6">
                  {["Royalty-free", "Free monthly credits", "Loop to any length"].map((chip) => (
                    <span
                      key={chip}
                      className="text-xs font-medium text-muted-foreground border border-border/60 rounded-full px-2.5 py-1 bg-secondary/40"
                    >
                      {chip}
                    </span>
                  ))}
                </div>
                <Link href="/soundtracks">
                  <Button variant="outline" className="border-primary/40 hover:bg-primary/10 hover:text-primary">
                    Create a Soundtrack
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* What's new — the differentiators */}
        <section className="py-16 border-t border-border/30 bg-black/30">
          <div className="container px-4 md:px-6 mx-auto max-w-6xl">
            <div className="text-center mb-10">
              <div className="inline-flex items-center rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-sm font-medium text-accent mb-4">
                <Sparkles className="mr-2 h-3.5 w-3.5" /> New &amp; exclusive
              </div>
              <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight mb-3">
                The details one-trick tools can't match
              </h2>
              <p className="text-muted-foreground max-w-2xl mx-auto">
                What turns a random AI clip into a polished, on-brand music video you're proud to post.
              </p>
            </div>
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {[
                { icon: Lock, title: "Character Lock", body: "Lock a face or look from a reference image so the same character carries across every clip — no shape-shifting between shots.", tag: "New" },
                { icon: Clapperboard, title: "Storyboard Preview", body: "See the planned shots — timing, energy, and prompt for each — before you spend a single credit. Approve, then render.", tag: "New" },
                { icon: Share2, title: "Release Kit", body: "One click turns your finished video into a full set of social exports — vertical, square, and Spotify Canvas — sized for every platform.", tag: "New" },
                { icon: Wand2, title: "Prompt Studio", body: "Describe a vibe in plain words and get a polished video or soundtrack prompt — or full, original lyrics — in seconds.", tag: "Beta" },
                { icon: Maximize, title: "Up to 4K & 10 minutes", body: "Go beyond quick clips: render crisp 4K and full-length videos up to ten minutes for premium releases.", tag: "New" },
                { icon: Music, title: "Royalty-free Soundtracks", body: "No track? Generate original instrumentals you fully own and drop them straight into a video.", tag: null as string | null },
              ].map((f) => (
                <div key={f.title} className="rounded-2xl border border-card-border bg-card p-6 transition-colors hover:border-primary/40">
                  <div className="flex items-center justify-between mb-4">
                    <div className="h-11 w-11 rounded-xl bg-primary/15 flex items-center justify-center">
                      <f.icon className="h-5 w-5 text-primary" />
                    </div>
                    {f.tag && (
                      <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold text-accent">{f.tag}</span>
                    )}
                  </div>
                  <h3 className="text-lg font-bold mb-1.5">{f.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{f.body}</p>
                </div>
              ))}
            </div>
            <div className="text-center mt-10">
              <Link href="/generate">
                <Button size="lg" className="bg-gradient-electric text-white shadow-glow border-0 hover:opacity-90">
                  <Play className="mr-2 h-4 w-4" /> Start your video
                </Button>
              </Link>
            </div>
          </div>
        </section>

        {/* Sample Videos Section */}
        <section className="py-20 border-t border-border/30 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-primary/5 to-transparent pointer-events-none" />
          <div className="container px-4 md:px-6 mx-auto relative z-10">
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5 }}
              className="text-center mb-12"
            >
              <div className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-sm font-medium text-primary mb-4 backdrop-blur-sm">
                <Sparkles className="mr-2 h-3.5 w-3.5" />
                Real AI-generated examples
              </div>
              <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight mb-3">
                See what AI Beat Sync creates
              </h2>
              <p className="text-muted-foreground text-lg max-w-xl mx-auto">
                Every video below was generated from a real audio track — click any to play.
              </p>
            </motion.div>

            <div className="grid md:grid-cols-3 gap-5">
              {SAMPLES.map((s, i) => (
                <motion.div
                  key={s.src}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: i * 0.1 }}
                >
                  <SampleVideo src={s.src} label={s.label} />
                </motion.div>
              ))}
            </div>

            <div className="text-center mt-10">
              <Link href="/register">
                <Button size="lg" className="bg-gradient-electric text-white shadow-glow border-0 hover:opacity-90">
                  <Play className="mr-2 h-4 w-4" />
                  Create your own
                </Button>
              </Link>
            </div>
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

        {/* Sneaky Feature Spotlight */}
        <section className="py-14 border-t border-border/30">
          <div className="container px-4 md:px-6 mx-auto">
            <div className="grid md:grid-cols-3 gap-6">
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4 }}
                className="flex gap-5 p-6 rounded-2xl bg-card border border-card-border"
              >
                <div className="flex-shrink-0 h-12 w-12 rounded-xl bg-accent/20 flex items-center justify-center">
                  <ScanLine className="h-6 w-6 text-accent" />
                </div>
                <div>
                  <h3 className="text-lg font-bold mb-1">Pick the exact moment</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">
                    Scrub through your track's waveform and pin the generator to any 5 or 10-second window — your drop, your hook, your key lyric — not just the beginning.
                  </p>
                </div>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: 0.1 }}
                className="flex gap-5 p-6 rounded-2xl bg-card border border-card-border"
              >
                <div className="flex-shrink-0 h-12 w-12 rounded-xl bg-pink-500/20 flex items-center justify-center">
                  <ImagePlus className="h-6 w-6 text-pink-400" />
                </div>
                <div>
                  <h3 className="text-lg font-bold mb-1">Start from your album art</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">
                    Upload a reference image — existing artwork, a photo, a mood board — and the AI uses it alongside your prompt to keep the visuals on-brand from the first frame.
                  </p>
                </div>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: 0.2 }}
                className="flex gap-5 p-6 rounded-2xl bg-card border border-[#1DB954]/25"
              >
                <div className="flex-shrink-0 h-12 w-12 rounded-xl flex items-center justify-center" style={{ background: "rgba(29,185,84,0.15)" }}>
                  <MonitorPlay className="h-6 w-6" style={{ color: "#1DB954" }} />
                </div>
                <div>
                  <h3 className="text-lg font-bold mb-1">Import straight from Suno</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">
                    Paste any Suno share link and we'll pull the track directly — no downloading, no re-uploading. Generate on Suno, visualize here.
                  </p>
                </div>
              </motion.div>
            </div>
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
