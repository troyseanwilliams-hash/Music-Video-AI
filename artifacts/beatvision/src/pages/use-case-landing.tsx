import { useEffect } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowRight, Sparkles, Wand2, Mic2, Music2, Film, Upload, Disc3, Images, Heart, Briefcase, Scissors } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { motion } from "framer-motion";
import { AuroraBackground } from "@/components/AuroraBackground";

interface Step { icon: LucideIcon; title: string; body: string }
interface UseCaseConfig {
  docTitle: string;
  metaDescription: string;
  badge: string;
  h1a: string; h1accent: string; h1b: string;
  subhead: string;
  ctaLabel: string; ctaHref: string;
  steps: Step[];
  seo: string;
}

// SEO landing pages targeting high-intent search queries. Each funnels straight
// into the relevant generator. Public — no auth required to view.
function UseCaseLanding({ cfg }: { cfg: UseCaseConfig }) {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = cfg.docTitle;
    const meta = document.querySelector('meta[name="description"]');
    const prev = meta?.getAttribute("content") ?? null;
    meta?.setAttribute("content", cfg.metaDescription);

    // Set a self-referential canonical so each long-tail landing page is indexed
    // on its own URL (and genre variants aren't flagged as duplicates).
    const href = `https://aibeatsync.com${window.location.pathname}`;
    let canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    const prevCanonical = canonical?.getAttribute("href") ?? null;
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.setAttribute("rel", "canonical");
      document.head.appendChild(canonical);
    }
    canonical.setAttribute("href", href);

    return () => {
      document.title = prevTitle;
      if (prev && meta) meta.setAttribute("content", prev);
      if (prevCanonical && canonical) canonical.setAttribute("href", prevCanonical);
    };
  }, [cfg]);

  return (
    <div className="relative overflow-hidden">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[700px] bg-primary/8 rounded-full blur-[160px] pointer-events-none" />
      <AuroraBackground className="opacity-60" />

      <section className="container mx-auto px-6 pt-20 pb-14 max-w-3xl text-center relative z-10">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary mb-6">
            <Sparkles className="h-3.5 w-3.5" />
            {cfg.badge}
          </div>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">
            {cfg.h1a} <span className="bg-gradient-electric bg-clip-text text-transparent">{cfg.h1accent}</span> {cfg.h1b}
          </h1>
          <p className="text-muted-foreground text-lg mb-8">{cfg.subhead}</p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href={cfg.ctaHref}>
              <Button size="lg" className="h-12 px-6 bg-gradient-electric text-white shadow-glow">
                {cfg.ctaLabel}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
            <Link href="/pricing">
              <Button size="lg" variant="outline" className="h-12 px-6">See pricing</Button>
            </Link>
          </div>
        </motion.div>
      </section>

      <section className="container mx-auto px-6 pb-16 max-w-4xl relative z-10">
        <div className="grid gap-4 sm:grid-cols-3">
          {cfg.steps.map((s, i) => (
            <motion.div
              key={s.title}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.1 * i }}
              className="rounded-xl border border-border/60 bg-background/40 p-5"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 border border-primary/20 mb-3">
                <s.icon className="h-4 w-4 text-primary" />
              </div>
              <h3 className="font-semibold mb-1">{s.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{s.body}</p>
            </motion.div>
          ))}
        </div>

        <p className="text-sm text-muted-foreground leading-relaxed mt-10 max-w-2xl mx-auto text-center">{cfg.seo}</p>

        <div className="text-center mt-8">
          <Link href={cfg.ctaHref}>
            <Button size="lg" className="h-12 px-6 bg-gradient-electric text-white shadow-glow">
              {cfg.ctaLabel} <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        </div>
      </section>
    </div>
  );
}

// ── Configs ──────────────────────────────────────────────────────────────────

export function AiMusicVideoLanding() {
  return <UseCaseLanding cfg={{
    docTitle: "AI Music Video Generator — Turn a Song Into a Video | AIBeatSync",
    metaDescription: "Turn any song into a cinematic, beat-synced AI music video in minutes. Upload a track or generate one, pick a style, and download a video ready for YouTube, TikTok, and Reels.",
    badge: "One song in. A cinematic video out.",
    h1a: "Turn any song into an", h1accent: "AI music video", h1b: "",
    subhead: "Upload a track — or generate a royalty-free one — and our AI builds a beat-synced cinematic video, cut to your song's energy. No editing skills required.",
    ctaLabel: "Make my video", ctaHref: "/generate",
    steps: [
      { icon: Upload, title: "Add your song", body: "Upload any track, paste a link, or generate a royalty-free instrumental right here." },
      { icon: Wand2, title: "Pick a style", body: "Cinematic, anime, neon, and more — the AI generates shots timed to each section of your song." },
      { icon: Film, title: "Download & share", body: "Export up to 4K, plus one-click shorts and a Spotify Canvas loop for every platform." },
    ],
    seo: "AIBeatSync is an AI music video generator that turns your audio into cinematic, beat-synchronized visuals. Unlike raw AI video tools, it analyzes your song's structure and cuts each shot to the beat — then packages the whole release: the full video, vertical TikTok/Shorts cuts, a Spotify Canvas loop, and a thumbnail. Start free.",
  }} />;
}

export function LyricVideoLanding() {
  return <UseCaseLanding cfg={{
    docTitle: "AI Lyric Video Maker — Add Animated Lyrics to Your Song | AIBeatSync",
    metaDescription: "Make a lyric video from your song with AI. Generate a beat-synced music video and burn in karaoke-style animated lyrics — synced to the beat and ready to post.",
    badge: "Your words, on screen, on beat.",
    h1a: "Make an", h1accent: "AI lyric video", h1b: "for your song",
    subhead: "Generate a cinematic music video, then burn in karaoke-style lyrics that land on the beat. Paste plain lyrics or timestamped .lrc for exact sync.",
    ctaLabel: "Make my lyric video", ctaHref: "/generate",
    steps: [
      { icon: Wand2, title: "Generate the video", body: "AI creates a beat-synced cinematic video from your track." },
      { icon: Mic2, title: "Add your lyrics", body: "Paste lyrics (or .lrc timestamps) and we burn animated captions synced to the music." },
      { icon: Film, title: "Export & post", body: "Download the lyric video plus vertical cuts for TikTok, Reels, and Shorts." },
    ],
    seo: "AIBeatSync doubles as an AI lyric video maker: generate a music video, then overlay karaoke-style animated lyrics that follow the beat. Supports plain text, LRC line timestamps, and word-level enhanced LRC for precise, sing-along sync — no video editor required.",
  }} />;
}

export function InstrumentalLanding() {
  return <UseCaseLanding cfg={{
    docTitle: "AI Instrumental Generator — Royalty-Free Beats | AIBeatSync",
    metaDescription: "Generate royalty-free instrumental music with AI using credits. New accounts get 150 free credits; unused welcome credits expire when the 7-day trial ends.",
    badge: "Original beats. Royalty-free. Yours.",
    h1a: "Create with our", h1accent: "AI instrumental", h1b: "generator",
    subhead: "Describe the vibe — lofi, cinematic, trap, ambient — and get an original royalty-free instrumental in seconds. Score a video with it, loop it, or download it.",
    ctaLabel: "Generate a beat", ctaHref: "/soundtracks",
    steps: [
      { icon: Music2, title: "Describe the vibe", body: "Type a mood or genre and the AI composes an original instrumental." },
      { icon: Disc3, title: "Loop or reuse", body: "Loop it to any length, save it to My Music, or drop it into a video." },
      { icon: Film, title: "Turn it into a video", body: "One click sends your beat into the video generator for a full music video." },
    ],
    seo: "AIBeatSync's music generator creates original, royalty-free instrumental music from a text description using credits. New accounts get 150 free credits; unused welcome credits expire when the 7-day trial ends. Use the beats in your videos, streams, and social content, then turn any track into a cinematic AI music video in the same place.",
  }} />;
}

export function SunoToVideoLanding() {
  return <UseCaseLanding cfg={{
    docTitle: "Suno to Video — Turn Your Suno Song Into an AI Music Video | AIBeatSync",
    metaDescription: "Made a song in Suno? Turn it into a cinematic, beat-synced AI music video. Paste your Suno link or upload the track, pick a style, and export for YouTube, TikTok, and Reels.",
    badge: "From Suno track to finished video.",
    h1a: "Turn your", h1accent: "Suno song", h1b: "into a video",
    subhead: "Love the track you made in Suno? Paste the link or upload the file and our AI builds a beat-synced cinematic music video around it — then hands you social cuts for every platform.",
    ctaLabel: "Turn my Suno song into a video", ctaHref: "/generate",
    steps: [
      { icon: Upload, title: "Bring your Suno track", body: "Paste your Suno share link or upload the exported MP3 — no re-recording needed." },
      { icon: Wand2, title: "Pick a look", body: "The AI reads your song's beat and energy and generates cinematic shots timed to each section." },
      { icon: Film, title: "Export & post", body: "Download up to 4K, plus one-click TikTok/Reels/Shorts cuts and a Spotify Canvas loop." },
    ],
    seo: "AIBeatSync is the fastest way to turn a Suno song into a music video. Bring any AI-generated or uploaded track, and the engine analyzes its beat, mood, and structure to render beat-synced cinematic visuals — then packages the full release: the video, vertical social cuts, a Spotify Canvas loop, and a thumbnail. Start free.",
  }} />;
}

// Genre-targeted SEO pages. One config generator drives many long-tail landing
// pages ("[genre] music video generator") that all funnel into /generate.
function genreCfg(genre: string): UseCaseConfig {
  return {
    docTitle: `${genre} Music Video Generator — AI ${genre} Videos | AIBeatSync`,
    metaDescription: `Turn your ${genre} track into a cinematic, beat-synced AI music video. Upload or generate a ${genre} song, pick a look, and export visuals ready for YouTube, TikTok, and Reels.`,
    badge: `Built for ${genre}.`,
    h1a: "AI", h1accent: `${genre} music`, h1b: "videos",
    subhead: `Drop in a ${genre} track — or generate one right here — and our AI cuts a cinematic, beat-synced video to match its energy. No editing skills required.`,
    ctaLabel: "Make my video", ctaHref: "/generate",
    steps: [
      { icon: Upload, title: "Add your track", body: `Upload any ${genre} song, paste a link, or generate a royalty-free one on the spot.` },
      { icon: Wand2, title: "Pick a look", body: `The AI times cinematic shots to the beat and energy of your ${genre} track.` },
      { icon: Film, title: "Download & share", body: "Export up to 4K, plus one-click TikTok/Reels/Shorts cuts and a Spotify Canvas loop." },
    ],
    seo: `AIBeatSync turns ${genre} tracks into beat-synced cinematic music videos. Upload or generate a ${genre} song and the engine cuts each shot to the beat, then packages the full release — the video, vertical social cuts, a Spotify Canvas loop, and a thumbnail. Free to start.`,
  };
}

// ── Montage Studio positioning: slideshow / CapCut-alternative pages (CTA → editor) ──

export function SlideshowMakerLanding() {
  return <UseCaseLanding cfg={{
    docTitle: "AI Slideshow Maker — Turn Photos Into a Video With Music | AIBeatSync",
    metaDescription: "Turn your photos into a beautiful slideshow video with music and smooth transitions. Perfect for weddings, events, and work presentations — no editing skills needed. Free to start.",
    badge: "Photos in. A polished video out.",
    h1a: "Turn your photos into a", h1accent: "slideshow video", h1b: "",
    subhead: "Drop in your photos and clips, pick a song, and Montage Studio builds a smooth, beat-timed slideshow with transitions — ready for weddings, events, work, social, or just for fun. No editing skills required.",
    ctaLabel: "Make my slideshow", ctaHref: "/editor",
    steps: [
      { icon: Images, title: "Add your photos", body: "Drag in photos and video clips and arrange them on a simple timeline." },
      { icon: Music2, title: "Pick music & transitions", body: "Add a song (or generate one) and smooth crossfades — timed automatically." },
      { icon: Film, title: "Export & share", body: "Download your slideshow and one-click cuts for TikTok, Reels, and Shorts." },
    ],
    seo: "AIBeatSync's Montage Studio is a fast, simple slideshow maker: turn photos into a polished video with music and smooth transitions. A friendlier, AI-powered alternative to complex editors like CapCut — great for wedding slideshows, event recaps, and work presentations. Start free.",
  }} />;
}

export function WeddingSlideshowLanding() {
  return <UseCaseLanding cfg={{
    docTitle: "Wedding Slideshow Maker — Photos to a Video With Music | AIBeatSync",
    metaDescription: "Make a beautiful wedding slideshow from your photos in minutes. Add music and smooth transitions and export a video to share — no editing skills needed. Free to start.",
    badge: "Your day, set to music.",
    h1a: "Make a", h1accent: "wedding slideshow", h1b: "in minutes",
    subhead: "Turn your engagement, ceremony, and reception photos into a heartfelt slideshow video with music and elegant transitions — ready to play at the reception or share with family.",
    ctaLabel: "Make my wedding video", ctaHref: "/editor",
    steps: [
      { icon: Heart, title: "Add your photos", body: "Upload the moments that matter and put them in the order you want." },
      { icon: Music2, title: "Choose your song", body: "Add your first-dance track or generate a royalty-free one, with smooth transitions between shots." },
      { icon: Film, title: "Share the memory", body: "Export a polished video to play at the reception or send to friends and family." },
    ],
    seo: "AIBeatSync makes wedding slideshows easy: upload your photos, add music, and get a polished video with smooth transitions — no video editor required. A simple, AI-powered alternative to CapCut for couples and wedding pros. Free to start.",
  }} />;
}

export function CapcutAlternativeLanding() {
  return <UseCaseLanding cfg={{
    docTitle: "A Simpler CapCut Alternative — AI Video & Slideshow Editor | AIBeatSync",
    metaDescription: "Looking for a CapCut alternative? AIBeatSync's Montage Studio is a simple, AI-powered editor for slideshows, music videos, and social clips — timeline editing, music, transitions, and one-click social exports.",
    badge: "The simple, AI-powered CapCut alternative.",
    h1a: "A simpler", h1accent: "CapCut alternative", h1b: "",
    subhead: "Montage Studio gives you the essentials — a timeline, music, transitions, and one-click social exports — without the clutter. Build slideshows, music videos, and social clips, with AI to fill the gaps.",
    ctaLabel: "Open the editor", ctaHref: "/editor",
    steps: [
      { icon: Upload, title: "Add photos or clips", body: "Bring your own media or AI-generated clips onto a clean, simple timeline." },
      { icon: Scissors, title: "Trim, arrange, transition", body: "Cut, reorder, add music and smooth crossfades — no learning curve." },
      { icon: Film, title: "Export everywhere", body: "One click gives you vertical TikTok/Reels/Shorts cuts and a shareable video." },
    ],
    seo: "AIBeatSync's Montage Studio is a lightweight, AI-powered alternative to CapCut for slideshows, music videos, and social content. Timeline editing, music, smooth transitions, and one-click TikTok/Reels/Shorts exports — plus AI video and music generation built in. Free to start.",
  }} />;
}

export function PodcastToVideoLanding() {
  return <UseCaseLanding cfg={{
    docTitle: "Podcast to Video — Turn Your Episode Into an AI Music Video | AIBeatSync",
    metaDescription: "Made an episode on AIPodSync (or recorded your own)? Turn the audio into a cinematic AI video — upload the file, pick a style, and export for YouTube, TikTok, and Reels.",
    badge: "From AIPodSync episode to finished video.",
    h1a: "Turn your", h1accent: "podcast episode", h1b: "into a video",
    subhead: "Wrote a script and got an AI-narrated episode on AIPodSync? Upload the finished audio here and our AI builds a cinematic video around it — timed to the narration, ready to post.",
    ctaLabel: "Upload my episode", ctaHref: "/generate",
    steps: [
      { icon: Mic2, title: "Bring your episode", body: "Upload the MP3 you downloaded from AIPodSync — or any podcast episode you've already recorded." },
      { icon: Wand2, title: "Pick a look", body: "Cinematic, documentary-style, abstract, and more — the AI paces visuals to your episode's length and mood." },
      { icon: Film, title: "Export & post", body: "Download the full video, plus one-click vertical cuts for TikTok, Reels, and Shorts." },
    ],
    seo: "AIBeatSync turns podcast episodes into videos — a natural next step after writing a script and generating an AI-narrated episode on AIPodSync. Upload the finished audio and the engine builds cinematic visuals paced to your episode, then packages social cuts for every platform. Start free.",
  }} />;
}

export function HipHopMusicVideoLanding() { return <UseCaseLanding cfg={genreCfg("Hip-Hop")} />; }
export function EdmMusicVideoLanding() { return <UseCaseLanding cfg={genreCfg("EDM")} />; }
export function RockMusicVideoLanding() { return <UseCaseLanding cfg={genreCfg("Rock")} />; }
export function PopMusicVideoLanding() { return <UseCaseLanding cfg={genreCfg("Pop")} />; }
export function CountryMusicVideoLanding() { return <UseCaseLanding cfg={genreCfg("Country")} />; }
export function LofiMusicVideoLanding() { return <UseCaseLanding cfg={genreCfg("Lo-Fi")} />; }
