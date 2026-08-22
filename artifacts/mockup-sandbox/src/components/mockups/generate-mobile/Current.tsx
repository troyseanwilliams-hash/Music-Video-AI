import "./_group.css";
import { AudioLines, ChevronDown, Clapperboard, Film, Layers, Music, Sparkles, Upload, WandSparkles, Zap } from "lucide-react";

const templates = [
  ["Neon TikTok loop", "Neon", "10 sec"],
  ["Anime music video", "Anime", "30 sec"],
  ["Cinematic trailer", "Cinematic", "30 sec"],
  ["Dreamy aesthetic", "Fantasy", "10 sec"],
  ["Retro 80s vibes", "Vintage", "10 sec"],
  ["Spotify Canvas loop", "Abstract", "5 sec"],
];

const presets = ["TikTok · Reels · Shorts", "YouTube", "Spotify Canvas", "Square feed"];

export function Current() {
  return (
    <div className="generate-preview">
      <header className="flex h-16 items-center justify-between border-b border-white/10 px-4">
        <div className="flex items-center gap-2 font-bold">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-blue-500">
            <Clapperboard className="h-4 w-4" />
          </span>
          AIBeatSync
        </div>
        <button className="rounded-lg bg-gradient-to-r from-violet-500 to-blue-500 px-3 py-2 text-xs font-semibold">Get Started</button>
      </header>

      <main className="mx-auto max-w-4xl space-y-5 px-4 py-6">
        <div>
          <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-violet-400/30 bg-violet-400/10 px-3 py-1 text-xs font-semibold text-violet-300">
            <Sparkles className="h-3.5 w-3.5" /> AI Generator
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight">Create a <span className="text-violet-400">new video</span></h1>
          <p className="mt-2 text-sm leading-6 text-white/55">Drop in a track — our AI reads its beat, energy, and mood, then generates a cinematic, beat-synced music video.</p>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3.5 text-sm leading-6 text-white/65">
          <strong className="text-white">Making a video</strong><br />
          Add audio, describe the look, pick your engine and a length.
        </div>

        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-sm font-semibold"><Sparkles className="h-4 w-4 text-violet-400" /> Quick start</span>
            <button className="flex items-center gap-1 rounded-lg border border-white/15 px-2.5 py-1.5 text-xs font-medium"><Music className="h-3.5 w-3.5" /> Create a Song</button>
          </div>
          <div className="flex flex-wrap gap-2">
            {templates.map(([label, style, duration]) => (
              <button key={label} className="rounded-full border border-white/15 bg-white/[0.04] px-3 py-1.5 text-sm font-medium">
                <span className="mr-1">{style === "Neon" ? "🌆" : style === "Anime" ? "🌸" : style === "Cinematic" ? "🎬" : style === "Fantasy" ? "✨" : style === "Vintage" ? "📼" : "🔁"}</span>{label}
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs text-white/50">Templates fill in a prompt, style, aspect ratio, and length — tweak anything after.</p>
          <p className="mt-1.5 text-xs text-white/50">Need narration for your video too? <span className="text-violet-300">Narrate your videos on AIPodSync</span>.</p>
          <div className="mt-4 border-t border-white/10 pt-3">
            <div className="mb-2 text-xs font-medium text-white/55">Sized for</div>
            <div className="flex flex-wrap gap-2">
              {presets.map((preset) => <button key={preset} className="rounded-full border border-white/15 bg-white/[0.04] px-3 py-1.5 text-sm font-medium">{preset === "TikTok · Reels · Shorts" ? "📱" : preset === "YouTube" ? "▶️" : preset === "Spotify Canvas" ? "🎵" : "⬛"} {preset}</button>)}
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.06] p-4 shadow-xl">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold"><AudioLines className="h-4 w-4 text-violet-400" /> Your video setup</div>
          <div className="grid gap-3">
            <div className="rounded-xl border border-dashed border-white/20 p-4 text-center text-sm text-white/60"><Upload className="mx-auto mb-2 h-5 w-5 text-violet-400" />Upload your track</div>
            <div>
              <div className="mb-2 text-sm font-medium">Creative Prompt</div>
              <div className="h-24 rounded-xl border border-white/15 bg-black/10 p-3 text-sm text-white/35">Describe the visual style, subject matter, and mood you want...</div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}