import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LYRICS_BUILD_COST, canAffordCredits } from "@/lib/creditPricing";
import { saveSceneScriptHandoff } from "@/lib/sceneScriptHandoff";
import { useGetDashboardStats } from "@workspace/api-client-react";
import TopUpRequiredDialog from "@/components/TopUpRequiredDialog";
import {
  Sparkles, Music2, Film, FileText, Copy, Check, Loader2, ArrowRight, Wand2, Lightbulb,
  ListOrdered, ChevronUp, ChevronDown, Plus, Trash2,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";

type AudioResult = { prompt: string; genre: string; mood: string; bpm: number | null; tags: string[]; source: string };
type LyricsResult = { lyrics: string; source: string };
type SceneBuilderScene = { number: number; title: string; imagePrompt: string };
type SceneBuilderResult = {
  mode: "montage" | "narrative";
  scenes: SceneBuilderScene[];
  script: string;
  sceneCount: number;
  hasReferenceImage: boolean;
  source: string;
};

const MAX_CREATIVE_PROMPT_LENGTH = 12_000;
const MAX_SCENE_IMAGE_PROMPT_LENGTH = 420;

function buildNumberedImageScript(scenes: SceneBuilderScene[]): string {
  return scenes.map((scene, index) => `${index + 1}. ${scene.imagePrompt.trim()}`).join("\n");
}

async function postJSON<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: Record<string, unknown> = {};
  if (text.trim()) {
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      const isHtml = /^\s*</.test(text);
      throw new Error(
        isHtml
          ? `The server could not complete this request (${res.status}). Please try again.`
          : "The server returned an unreadable response. Please try again.",
      );
    }
  }
  if (!res.ok) {
    throw new Error(
      typeof data.error === "string" ? data.error : `Request failed (${res.status})`,
    );
  }
  return data as T;
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? <Check className="mr-1.5 h-3.5 w-3.5" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}
      {copied ? "Copied" : label}
    </Button>
  );
}

// Clickable starter suggestions to help users write good descriptions. Each
// string is both the label (truncated for display) and the full prompt
// inserted on click — the untruncated text also shows as a hover tooltip
// (see Chips below) so nothing is hidden from the user before they commit to it.
const AUDIO_SAMPLES = [
  "dreamy lo-fi beat for a rainy night study session, mellow and nostalgic",
  "epic cinematic orchestral build for a movie trailer",
  "warm deep house groove, late-night rooftop, 122 BPM",
  "gritty boom-bap hip-hop with dusty vinyl and upright bass",
  "ethereal ambient pads for meditation, slow and weightless",
  "retro 80s synthwave, neon and chrome, driving arpeggios",
  "upbeat pop anthem with a big sing-along chorus, 118 BPM",
  "smooth R&B groove, warm electric piano, soulful and intimate",
  "high-energy EDM festival drop, pulsing sidechained bass",
  "sunny afrobeats with layered percussion and a groovy bassline",
];
const VIDEO_SAMPLES = [
  "a lone astronaut discovering a glowing forest on an alien planet at dusk",
  "neon-soaked cyberpunk street in the rain, reflections everywhere",
  "a surfer riding a giant wave in golden-hour slow motion",
  "close-up of a dancer spinning through drifting autumn leaves",
  "an old lighthouse in a storm, waves crashing, dramatic and cinematic",
  "a couple's first dance at a candlelit wedding reception, warm and intimate",
  "a drone shot soaring over a sunset skyline into the city lights",
  "a runner sprinting through city streets at dawn, determined and driven",
];
const LYRIC_SAMPLES = [
  "chasing a dream across a city that never sleeps",
  "letting go of someone you still love",
  "a road trip with no destination and nothing to lose",
  "finding your voice after years of silence",
  "the last summer before everything changed",
  "falling in love for the first time and not being scared of it",
  "coming out the other side of a hard year, stronger than before",
  "the friends who showed up when it mattered most",
  "missing home while chasing something bigger",
];

// Replaces the old wrapping grid of pill buttons — same "click an example
// to fill the field" behavior, but as a single compact trigger instead of
// 8-10 chips crowding the page. Not a controlled Select: picking one is a
// one-off action (fills the textarea), not a persistent field value, so a
// menu fits better than something that would sit there showing "selected".
function PresetMenu({ items, onPick, label = "Need inspiration?" }: { items: string[]; onPick: (v: string) => void; label?: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="text-muted-foreground font-normal">
          <Lightbulb className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[min(24rem,calc(100vw-2rem))] max-h-72 overflow-y-auto">
        <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">Pick an example to start from</DropdownMenuLabel>
        {items.map((s) => (
          <DropdownMenuItem key={s} onSelect={() => onPick(s)} className="whitespace-normal text-sm py-2">
            {s}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function PromptStudio() {
  const { user, isAuthenticated, isLoading } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  // Audio tab
  const [audioDesc, setAudioDesc] = useState("");
  const [audioBusy, setAudioBusy] = useState(false);
  const [audioRes, setAudioRes] = useState<AudioResult | null>(null);

  // Video scene builder
  const [story, setStory] = useState("");
  const [sceneCount, setSceneCount] = useState(6);
  const [autoSceneCount, setAutoSceneCount] = useState(true);
  const [hasReferenceImage, setHasReferenceImage] = useState(false);
  const [sceneBusy, setSceneBusy] = useState(false);
  const [sceneRes, setSceneRes] = useState<SceneBuilderResult | null>(null);

  // Lyrics tab
  const [theme, setTheme] = useState("");
  const [genre, setGenre] = useState("");
  const [mood, setMood] = useState("");
  const [explicit, setExplicit] = useState(false);
  const [bpm, setBpm] = useState("");
  const [lyricsBusy, setLyricsBusy] = useState(false);
  const [lyricsRes, setLyricsRes] = useState<LyricsResult | null>(null);
  const { data: statsData } = useGetDashboardStats({});
  const balance = statsData?.creditsRemaining ?? null;
  const [topUpOpen, setTopUpOpen] = useState(false);

  const fail = (err: unknown) =>
    toast({ title: "Couldn't build that", description: err instanceof Error ? err.message : "Try again", variant: "destructive" });

  async function buildAudio() {
    if (audioDesc.trim().length < 2) return;
    setAudioBusy(true);
    try {
      setAudioRes(await postJSON<AudioResult>("/api/prompt/audio", { description: audioDesc }));
    } catch (err) { fail(err); } finally { setAudioBusy(false); }
  }
  async function buildScenes() {
    if (story.trim().length < 2) return;
    setSceneBusy(true);
    try {
      setSceneRes(await postJSON<SceneBuilderResult>("/api/prompt/video-scenes", {
        story,
        sceneCount: autoSceneCount
          ? Math.max(3, Math.min(12, Math.round(story.trim().split(/\s+/).length / 45) || 3))
          : sceneCount,
        hasReferenceImage,
      }));
    } catch (err) { fail(err); } finally { setSceneBusy(false); }
  }
  function updateScenes(transform: (scenes: SceneBuilderScene[]) => SceneBuilderScene[]) {
    setSceneRes((current) => {
      if (!current) return current;
      const scenes = transform(current.scenes).map((scene, index) => ({
        ...scene,
        number: index + 1,
      }));
      return {
        ...current,
        scenes,
        sceneCount: scenes.length,
        script: buildNumberedImageScript(scenes),
      };
    });
  }
  function updateScene(index: number, patch: Partial<Pick<SceneBuilderScene, "title" | "imagePrompt">>) {
    updateScenes((scenes) => scenes.map((scene, sceneIndex) =>
      sceneIndex === index ? { ...scene, ...patch } : scene
    ));
  }
  function moveScene(index: number, direction: -1 | 1) {
    updateScenes((scenes) => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= scenes.length) return scenes;
      const next = [...scenes];
      [next[index], next[nextIndex]] = [next[nextIndex]!, next[index]!];
      return next;
    });
  }
  async function buildLyrics() {
    if (theme.trim().length < 2) return;
    // Proactive credit check — show the top-up modal instead of letting the
    // user hit a backend failure after submitting.
    if (!canAffordCredits(LYRICS_BUILD_COST, balance)) {
      setTopUpOpen(true);
      return;
    }
    setLyricsBusy(true);
    try {
      setLyricsRes(await postJSON<LyricsResult>("/api/prompt/lyrics", {
        theme,
        genre: genre || undefined,
        mood: mood || undefined,
        explicit,
        bpm: bpm.trim() ? Number(bpm) : undefined,
      }));
    } catch (err) { fail(err); } finally { setLyricsBusy(false); }
  }

  const sceneScript = sceneRes
    ? sceneRes.mode === "narrative" ? sceneRes.script : buildNumberedImageScript(sceneRes.scenes)
    : "";
  const sceneScriptValid =
    sceneRes !== null
    && (sceneRes.mode === "narrative"
      ? sceneRes.script.trim().length >= 2
      : sceneRes.scenes.length >= 2
        && sceneRes.scenes.every((scene) => scene.imagePrompt.trim().length > 0))
    && sceneScript.length <= MAX_CREATIVE_PROMPT_LENGTH;

  if (isLoading) {
    return <div className="min-h-[60vh] flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }
  if (!isAuthenticated) {
    return (
      <div className="container mx-auto px-4 py-20 max-w-md text-center">
        <Sparkles className="mx-auto h-10 w-10 text-primary mb-4" />
        <h1 className="text-2xl font-bold mb-2">Prompt</h1>
        <p className="text-muted-foreground mb-6">Sign in to build polished prompts for your videos and soundtracks.</p>
        <Link href="/login"><Button size="lg" className="bg-gradient-electric text-white border-0">Sign in</Button></Link>
      </div>
    );
  }
  return (
    <>
    <div className="container mx-auto px-4 py-8 sm:py-12 max-w-3xl">
      <div className="mb-8 text-center">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-electric shadow-glow mb-3">
          <Sparkles className="h-6 w-6 text-white" />
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
          Prompt
        </h1>
        <p className="text-muted-foreground mt-2 text-sm sm:text-base max-w-xl mx-auto">
          Describe what you want in plain words — we'll turn it into a ready-to-use prompt. The soundtrack and video
          scene builders are free; writing full lyrics costs {LYRICS_BUILD_COST} credits.
        </p>
      </div>

      <Tabs defaultValue="audio" className="w-full">
        <TabsList className="grid h-auto w-full grid-cols-3">
          <TabsTrigger value="audio"><Music2 className="mr-1.5 h-4 w-4" /> Soundtrack</TabsTrigger>
          <TabsTrigger value="video"><Film className="mr-1.5 h-4 w-4" /> Video</TabsTrigger>
          <TabsTrigger value="lyrics"><FileText className="mr-1.5 h-4 w-4" /> Lyrics</TabsTrigger>
        </TabsList>

        {/* Audio */}
        <TabsContent value="audio" className="space-y-4 pt-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <label className="text-sm font-medium">Describe the vibe</label>
            <PresetMenu items={AUDIO_SAMPLES} onPick={setAudioDesc} label="Need inspiration?" />
          </div>
          <Textarea
            value={audioDesc}
            onChange={(e) => setAudioDesc(e.target.value)}
            placeholder="e.g. dreamy lofi beat for a rainy night study session, mellow and nostalgic"
            className="min-h-[90px]"
          />
          <Button onClick={buildAudio} disabled={audioBusy || audioDesc.trim().length < 2} className="bg-gradient-electric text-white border-0">
            {audioBusy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Building…</> : <><Wand2 className="mr-2 h-4 w-4" /> Build music prompt</>}
          </Button>

          {audioRes && (
            <div className="rounded-xl border border-border/60 bg-secondary/30 p-4 space-y-3">
              <p className="text-sm leading-relaxed">{audioRes.prompt}</p>
              <div className="flex flex-wrap gap-1.5 text-xs">
                {audioRes.genre && <span className="rounded-full bg-primary/15 border border-primary/20 px-2 py-0.5">{audioRes.genre}</span>}
                {audioRes.mood && <span className="rounded-full bg-primary/15 border border-primary/20 px-2 py-0.5">{audioRes.mood}</span>}
                {audioRes.bpm && <span className="rounded-full bg-primary/15 border border-primary/20 px-2 py-0.5">{audioRes.bpm} BPM</span>}
                {audioRes.tags.map((t) => <span key={t} className="rounded-full bg-secondary px-2 py-0.5 text-muted-foreground">{t}</span>)}
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                <CopyButton text={audioRes.prompt} />
                <Button size="sm" onClick={() => setLocation(`/soundtracks?prompt=${encodeURIComponent(audioRes.prompt)}`)}>
                  Use in Soundtracks <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </TabsContent>

        {/* Video scene builder */}
        <TabsContent value="video" className="space-y-4 pt-4">
          <div>
            <label htmlFor="scene-builder-story" className="text-sm font-medium">
              Describe your video story
            </label>
            <p className="mt-1 text-xs text-muted-foreground">
              We’ll turn it into a chronological, bulleted scene list that you can edit before using it in Generate.
            </p>
          </div>
          <PresetMenu items={VIDEO_SAMPLES} onPick={setStory} label="Need inspiration?" />
          <Textarea
            id="scene-builder-story"
            value={story}
            onChange={(event) => setStory(event.target.value)}
            maxLength={MAX_CREATIVE_PROMPT_LENGTH}
            placeholder="e.g. A young inventor leaves her quiet village, crosses a dangerous desert, discovers a hidden city, and returns home with a new source of clean energy."
            className="min-h-[140px]"
          />
          <div className="flex justify-end">
            <span className={`text-xs tabular-nums ${story.length >= MAX_CREATIVE_PROMPT_LENGTH - 500 ? "text-yellow-500" : "text-muted-foreground"}`}>
              {story.length.toLocaleString()} / {MAX_CREATIVE_PROMPT_LENGTH.toLocaleString()}
            </span>
          </div>

          <div className="grid gap-3 rounded-xl border border-border/60 bg-secondary/20 p-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={autoSceneCount}
                  onChange={(event) => setAutoSceneCount(event.target.checked)}
                  className="h-4 w-4 rounded border-border accent-primary"
                />
                Recommend the scene count
              </label>
              {!autoSceneCount && (
                <div className="flex items-center gap-2">
                  <label htmlFor="scene-count" className="text-xs text-muted-foreground">Scenes</label>
                  <Input
                    id="scene-count"
                    type="number"
                    min={2}
                    max={20}
                    value={sceneCount}
                    onChange={(event) => setSceneCount(Math.max(2, Math.min(20, Number(event.target.value) || 2)))}
                    className="h-9 w-24"
                  />
                </div>
              )}
            </div>
            <div>
              <label className="flex cursor-pointer items-start gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={hasReferenceImage}
                  onChange={(event) => {
                    setHasReferenceImage(event.target.checked);
                    setSceneRes(null);
                  }}
                  className="mt-0.5 h-4 w-4 rounded border-border accent-primary"
                />
                <span>
                  I’ll attach a reference image
                  <span className="mt-1 block text-xs font-normal leading-relaxed text-muted-foreground">
                    Character scenes will refer to the attached image instead of repeating a character description.
                  </span>
                </span>
              </label>
            </div>
          </div>

          <Button
            onClick={buildScenes}
            disabled={sceneBusy || story.trim().length < 2}
            className="bg-gradient-electric text-white border-0"
          >
            {sceneBusy
              ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Building scenes…</>
               : <><Wand2 className="mr-2 h-4 w-4" /> Build scene list</>}
          </Button>

          {sceneRes && (
            <div className="space-y-4 rounded-xl border border-border/60 bg-secondary/20 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">
                    {sceneRes.mode === "narrative" ? "Editable narrative story" : `${sceneRes.scenes.length} editable image prompts`}
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {sceneRes.mode === "narrative"
                      ? "Keep this as natural prose. Generate will build and ask you to approve the exact scene plan."
                      : <>One still image, moment, and setting per scene.
                        {sceneRes.hasReferenceImage ? " Character scenes use the attached reference image." : ""}</>}
                  </p>
                </div>
                <span className={`text-xs tabular-nums ${sceneScript.length > MAX_CREATIVE_PROMPT_LENGTH ? "font-medium text-destructive" : "text-muted-foreground"}`}>
                  {sceneScript.length.toLocaleString()} / {MAX_CREATIVE_PROMPT_LENGTH.toLocaleString()}
                </span>
              </div>

              {sceneRes.mode === "narrative" ? (
                <Textarea
                  value={sceneRes.script}
                  maxLength={MAX_CREATIVE_PROMPT_LENGTH}
                  onChange={(event) => setSceneRes((current) => current ? { ...current, script: event.target.value } : current)}
                  aria-label="Narrative story"
                  className="min-h-[180px] resize-y"
                />
              ) : (
              <div className="space-y-3">
                {sceneRes.scenes.map((scene, index) => (
                  <div key={`${scene.number}-${index}`} className="rounded-lg border border-border bg-background/70 p-3">
                    <div className="mb-2 flex items-center gap-2">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                        {index + 1}
                      </span>
                      <Input
                        value={scene.title}
                        maxLength={70}
                        onChange={(event) => updateScene(index, { title: event.target.value })}
                        aria-label={`Scene ${index + 1} title`}
                        className="h-9 font-medium"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => moveScene(index, -1)}
                        disabled={index === 0}
                        aria-label={`Move scene ${index + 1} up`}
                      >
                        <ChevronUp className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => moveScene(index, 1)}
                        disabled={index === sceneRes.scenes.length - 1}
                        aria-label={`Move scene ${index + 1} down`}
                      >
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => updateScenes((scenes) => scenes.filter((_, sceneIndex) => sceneIndex !== index))}
                        disabled={sceneRes.scenes.length <= 2}
                        aria-label={`Delete scene ${index + 1}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <Textarea
                      value={scene.imagePrompt}
                      maxLength={MAX_SCENE_IMAGE_PROMPT_LENGTH}
                      onChange={(event) => updateScene(index, { imagePrompt: event.target.value })}
                      aria-label={`Scene ${index + 1} image prompt`}
                      className="min-h-[88px] resize-y"
                    />
                    <p className="mt-1 text-right text-[11px] tabular-nums text-muted-foreground">
                      {scene.imagePrompt.length} / {MAX_SCENE_IMAGE_PROMPT_LENGTH}
                    </p>
                  </div>
                ))}
              </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                {sceneRes.mode === "montage" && <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={sceneRes.scenes.length >= 20}
                  onClick={() => updateScenes((scenes) => [
                    ...scenes,
                    { number: scenes.length + 1, title: `Scene ${scenes.length + 1}`, imagePrompt: "" },
                  ])}
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" /> Add scene
                </Button>}
                <CopyButton text={sceneScript} label="Copy script" />
                <Button
                  type="button"
                  size="sm"
                  disabled={!sceneScriptValid}
                  onClick={() => {
                     if (!saveSceneScriptHandoff({ mode: "narrative", script: story.trim() })) {
                       fail(new Error("The short story does not fit the Creative Prompt field."));
                      return;
                    }
                    setLocation("/generate");
                  }}
                >
                  Use in Generate <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                </Button>
              </div>
              {!sceneScriptValid && (
                <p className="text-xs text-destructive">
                  Every scene needs an image prompt, and the complete numbered script must stay within 12,000 characters.
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                This is a planning preview. Generate will rebuild the final chronological scene list from your original story after the music and duration are known.
              </p>
            </div>
          )}
        </TabsContent>

        {/* Lyrics */}
        <TabsContent value="lyrics" className="space-y-4 pt-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <label className="text-sm font-medium">What's the song about?</label>
            <PresetMenu items={LYRIC_SAMPLES} onPick={setTheme} label="Need inspiration?" />
          </div>
          <Textarea
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            placeholder="e.g. chasing a dream across a city that never sleeps"
            className="min-h-[80px]"
          />
          <div className="flex flex-wrap gap-2">
            <Input value={genre} onChange={(e) => setGenre(e.target.value)} placeholder="Genre (optional)" className="flex-1 min-w-[140px] sm:max-w-[200px]" />
            <Input value={mood} onChange={(e) => setMood(e.target.value)} placeholder="Mood (optional)" className="flex-1 min-w-[140px] sm:max-w-[200px]" />
          </div>
          <p className="text-xs text-muted-foreground -mt-1">
            Adding a genre and mood makes the lyrics fit the sound — the writer matches diction and rhythm to the style.
          </p>

          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Language</label>
              <div className="mt-1 flex items-center gap-1 rounded-lg border border-border p-1">
                <button
                  type="button"
                  onClick={() => setExplicit(false)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${!explicit ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"}`}
                >
                  Clean
                </button>
                <button
                  type="button"
                  onClick={() => setExplicit(true)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${explicit ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"}`}
                >
                  Explicit
                </button>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Tempo (BPM)</label>
              <Input
                type="number"
                inputMode="numeric"
                min={40}
                max={240}
                value={bpm}
                onChange={(e) => setBpm(e.target.value)}
                placeholder="optional"
                className="mt-1 w-28"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground -mt-1">
            Set the BPM and we'll shape line length to sit on the beat. Leave it blank if you're not sure.
          </p>

          <Button onClick={buildLyrics} disabled={lyricsBusy || theme.trim().length < 2} className="bg-gradient-electric text-white border-0">
            {lyricsBusy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Writing…</> : <><Wand2 className="mr-2 h-4 w-4" /> Write lyrics · {LYRICS_BUILD_COST} cr</>}
          </Button>

          {lyricsRes && (
            <div className="rounded-xl border border-border/60 bg-secondary/30 p-4 space-y-3">
              <pre className="text-sm leading-relaxed whitespace-pre-wrap font-sans">{lyricsRes.lyrics}</pre>
              <div className="flex flex-wrap items-center gap-2">
                <CopyButton text={lyricsRes.lyrics} label="Copy lyrics" />
                <Button
                  size="sm"
                  onClick={() =>
                    setLocation(
                      `/soundtracks?vocals=1&lyrics=${encodeURIComponent(lyricsRes.lyrics)}` +
                        (theme.trim() ? `&prompt=${encodeURIComponent(theme.trim())}` : ""),
                    )
                  }
                >
                  Export to Soundtracks <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>

    <TopUpRequiredDialog
      open={topUpOpen}
      onOpenChange={setTopUpOpen}
      creditsRequired={LYRICS_BUILD_COST}
      creditsRemaining={balance ?? 0}
      title="More credits needed for lyrics"
    />
    </>
  );
}
