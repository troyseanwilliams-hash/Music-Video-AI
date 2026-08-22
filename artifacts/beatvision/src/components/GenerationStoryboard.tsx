import { motion } from "framer-motion";
import {
  AudioWaveform,
  Clapperboard,
  Clock3,
  Film,
  Layers3,
  Scissors,
  Sparkles,
  WandSparkles,
} from "lucide-react";

export interface StoryboardShot {
  index: number;
  label: string;
  startTime: number;
  energy: number;
  prompt: string;
}

export interface StoryboardPlan {
  generationMode?: string;
  numClips: number;
  clipDurationSec: number;
  targetOutputDuration: number;
  timelineSceneCount?: number;
  reuseCount?: number;
  approximate: boolean;
  shots: StoryboardShot[];
}

interface GenerationStoryboardProps {
  storyboard: StoryboardPlan;
  completedClipIndexes: number[];
  status: string;
  bpm?: number | null;
  mood?: string | null;
}

function timestamp(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

export default function GenerationStoryboard({
  storyboard,
  completedClipIndexes,
  status,
  bpm,
  mood,
}: GenerationStoryboardProps) {
  const shots = storyboard.shots;
  const completedSet = new Set(completedClipIndexes);

  if (shots.length === 0) return null;

  const activeShot =
    shots.find((shot) => !completedSet.has(shot.index)) ??
    shots[shots.length - 1]!;
  const completed = Math.min(completedSet.size, storyboard.numClips);
  const isNarrative = storyboard.generationMode === "narrative";
  const energyPercent = Math.round(Math.max(0, Math.min(1, activeShot.energy)) * 100);
  const targetDuration = timestamp(storyboard.targetOutputDuration);
  const stage =
    status === "analyzing"
      ? {
          label: "Reading your track",
          detail: "Finding the rhythm, mood, and strongest moments that will shape each scene.",
          icon: AudioWaveform,
        }
      : status === "generating"
        ? {
            label: `Creating ${isNarrative ? "scene" : "visual"} ${Math.min(completed + 1, storyboard.numClips)} of ${storyboard.numClips}`,
            detail: isNarrative
              ? "This chronological scene follows the reviewed story plan and preserves continuity with the surrounding scenes."
              : "This visual motif is being built from your direction and matched to the track's energy.",
            icon: WandSparkles,
          }
        : status === "stitching"
          ? {
              label: "Assembling the final cut",
              detail: isNarrative
                ? "Placing every completed scene in chronological order, then aligning the final cut to your audio."
                : "Arranging and recalling the completed visuals across the track, then aligning the final cut to your audio.",
              icon: Scissors,
            }
          : {
              label: "Your video blueprint",
              detail: "The scene plan is ready. A renderer will begin turning it into your finished video shortly.",
              icon: Film,
            };
  const StageIcon = stage.icon;

  return (
    <section
      aria-label="Video creation progress"
      className="overflow-hidden rounded-xl border border-primary/20 bg-gradient-to-br from-primary/[0.08] via-card to-accent/[0.06]"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 px-4 py-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Clapperboard className="h-4 w-4 text-primary" />
            Making your video
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{stage.detail}</p>
        </div>
        <div className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs text-primary tabular-nums">
          {completed}/{storyboard.numClips} {isNarrative ? "scenes" : "visuals"} rendered
        </div>
      </div>

      <div className="p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-border/70 bg-background/50 p-3">
            <div className="flex items-center gap-2 text-xs font-medium text-primary">
              <StageIcon className="h-3.5 w-3.5" />
              In production now
            </div>
            <p className="mt-2 text-sm font-semibold">{stage.label}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {status === "generating"
                ? `${activeShot.label} begins near ${timestamp(activeShot.startTime)}.`
                : (isNarrative
                    ? `${storyboard.numClips} unique scenes · ${storyboard.timelineSceneCount ?? storyboard.numClips} timeline slots · ${targetDuration} target runtime.`
                    : `${storyboard.numClips} unique visuals · ${storyboard.timelineSceneCount ?? storyboard.numClips} timeline cuts · ${targetDuration} target runtime.`)}
            </p>
          </div>

          <div className="rounded-lg border border-border/70 bg-background/50 p-3">
            <div className="flex items-center gap-2 text-xs font-medium text-primary">
              <AudioWaveform className="h-3.5 w-3.5" />
              Track direction
            </div>
            <p className="mt-2 text-sm font-semibold">
              {bpm ? `${Math.round(bpm)} BPM` : "Audio profile pending"}
              {mood ? ` · ${mood}` : ""}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {storyboard.approximate
                ? "Scene timing will refine once the audio analysis completes."
                : "Scene pacing and energy are matched to the analyzed track."}
            </p>
          </div>

          <div className="rounded-lg border border-border/70 bg-background/50 p-3">
            <div className="flex items-center gap-2 text-xs font-medium text-primary">
              <Layers3 className="h-3.5 w-3.5" />
              Final cut plan
            </div>
            <p className="mt-2 text-sm font-semibold">
              {status === "stitching"
                ? (isNarrative ? "Synchronizing the timeline and audio" : "Synchronizing the montage and audio")
                : (isNarrative
                    ? `${storyboard.timelineSceneCount ?? storyboard.numClips} unique chronological scenes`
                    : `${storyboard.timelineSceneCount ?? storyboard.numClips} music-timed cuts`)}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {status === "stitching"
                ? (isNarrative
                    ? "Chronological scenes are being aligned to the final cut, with strict continuity and no reuse."
                    : "Visual motifs are being alternated and recalled intentionally across one polished music video.")
                : (isNarrative
                    ? "Every timeline slot receives a newly rendered scene. No visual recalls."
                    : `${storyboard.reuseCount ?? 0} intentional visual recalls keep longer Montage videos affordable.`)}
            </p>
          </div>
        </div>

        {status === "generating" && (
          <motion.div
            key={activeShot.index}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="mt-3 rounded-lg border border-primary/20 bg-primary/[0.045] p-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <p className="text-sm font-semibold">
                  {isNarrative ? "Scene" : "Visual"} {activeShot.index + 1}:{" "}
                  <span className="capitalize">{activeShot.label}</span>
                </p>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock3 className="h-3.5 w-3.5" />
                Starts near {timestamp(activeShot.startTime)}
              </div>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <div className="min-w-20 text-xs text-muted-foreground">
                Energy <span className="font-medium text-foreground">{energyPercent}%</span>
              </div>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${energyPercent}%` }}
                  className="h-full rounded-full bg-gradient-to-r from-primary to-accent"
                />
              </div>
            </div>
            <p className="mt-3 text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
              {isNarrative ? "Scene direction" : "Visual direction"}
            </p>
            <p className="mt-1 text-sm leading-relaxed text-foreground/90">{activeShot.prompt}</p>
          </motion.div>
        )}

        <div className="mt-4 flex gap-1.5" aria-label={`Video ${isNarrative ? "scene" : "visual"} progress`}>
          {shots.map((shot) => (
            <span
              key={shot.index}
              aria-label={`${isNarrative ? "Scene" : "Visual"} ${shot.index + 1}: ${
                completedSet.has(shot.index)
                  ? "rendered"
                  : shot.index === activeShot.index && status === "generating"
                    ? "being generated"
                    : "planned"
              }`}
              className={`flex h-2 min-w-6 flex-1 rounded-full ${
                completedSet.has(shot.index)
                  ? "bg-green-500/70"
                  : shot.index === activeShot.index && status === "generating"
                    ? "bg-primary"
                    : "bg-muted"
              }`}
            />
          ))}
        </div>
      </div>
    </section>
  );
}