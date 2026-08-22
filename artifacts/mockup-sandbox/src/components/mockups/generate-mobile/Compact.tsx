import { useState } from "react";
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

export function Compact() {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState("");
  const selectedLabel = selected || "Choose a template";

  return (
    <div className="generate-preview">
      <header className="flex h-16 items-center justify-between border-b border-white/10 px-4">
        <div className="flex items-center gap-2 font-bold">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-blue-500"><Clapperboard className="h-4 w-4" /></span>
          AIBeatSync
        </div>
        <button className="rounded-lg bg-gradient-to-r from-violet-500 to-blue-500 px-3 py-2 text-xs font-semibold">Get Started</button>
      </header>

      <main className="mx-auto max-w-4xl space-y-5 px-4 py-6">
        <div>
          <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-violet-400/30 bg-violet-400/10 px-3 py-1 text-xs font-semibold text-violet-300"><Sparkles className="h-3.5 w-3.5" /> AI Generator</div>
          <h1 className="text-3xl font-extrabold tracking-tight">Create a <span className="text-violet-400">new video</span></h1>
          <p className="mt-2 text-sm leading-6 text-white/55">Drop in a track — our AI reads its beat, energy, and mood, then generates a cinematic, beat-synced music video.</p>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3.5 text-sm leading-6 text-white/65">
          <strong className="text-white">Making a video</strong><br />
          Add audio, describe the look, pick your engine and a length.
        </div>

        <section className="relative rounded-2xl border border-violet-400/25 bg-gradient-to-r from-violet-500/[0.08] to-blue-500/[0.06] p-3.5">
          <div className="flex items-center gap-3">
            <div className="flex min-w-0 flex-1 items-center gap-2 max-[359px]:hidden">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-400/15 text-violet-300"><WandSparkles className="h-4 w-4" /></span>
              <div className="min-w-0">
                <div className="text-sm font-semibold">Quick start</div>
                <div className="truncate text-xs text-white/50">Start with a ready-made look</div>
              </div>
            </div>
            <button className="shrink-0 rounded-lg border border-white/15 px-2.5 py-1.5 text-xs font-medium"><Music className="mr-1 inline h-3.5 w-3.5" />Song</button>
            <button onClick={() => setOpen((value) => !value)} className="flex min-w-0 max-w-[145px] items-center gap-1 rounded-lg border border-violet-300/40 bg-violet-400/15 px-2.5 py-1.5 text-xs font-semibold text-violet-100">
              <span className="truncate">{selectedLabel}</span><ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
            </button>
          </div>
          {open && (
            <div className="absolute left-3 right-3 top-[calc(100%+8px)] z-10 rounded-xl border border-white/15 bg-[#171322] p-2 shadow-2xl">
              <div className="mb-1 px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-white/40">Choose a starting point</div>
              <div className="grid grid-cols-2 gap-1">
                {templates.map(([label, style, duration]) => (
                  <button key={label} onClick={() => { setSelected(label); setOpen(false); }} className="min-w-0 rounded-lg px-2 py-2 text-left text-xs hover:bg-white/10">
                    <div className="truncate font-medium text-white/90">{label}</div><div className="mt-0.5 text-[10px] text-white/45">{style} · {duration}</div>
                  </button>
                ))}
              </div>
              <div className="mt-2 border-t border-white/10 pt-2">
                <div className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-white/40">Output size</div>
                <div className="grid grid-cols-2 gap-1">
                  {presets.map((preset) => <button key={preset} className="rounded-lg px-2 py-1.5 text-left text-xs text-white/70 hover:bg-white/10">{preset}</button>)}
                </div>
              </div>
            </div>
          )}
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