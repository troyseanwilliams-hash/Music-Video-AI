import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Clapperboard, Clock3, Sparkles } from "lucide-react";

export interface StoryboardShot {
  index: number;
  label: string;
  startTime: number;
  energy: number;
  prompt: string;
}

export interface StoryboardPlan {
  numClips: number;
  clipDurationSec: number;
  targetOutputDuration: number;
  approximate: boolean;
  shots: StoryboardShot[];
}

interface GenerationStoryboardProps {
  storyboard: StoryboardPlan;
  completedClipIndexes: number[];
  status: string;
}

const ROTATE_MS = 5000;

function stageCopy(status: string): string {
  if (status === "queued") return "Your scenes are planned and waiting for a renderer.";
  if (status === "analyzing") return "Matching each scene to the rhythm and energy of your track.";
  if (status === "stitching") return "Your scenes are rendered — now assembling the final cut.";
  return "Cycling through your planned scenes while the video renders.";
}

function timestamp(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

export default function GenerationStoryboard({
  storyboard,
  completedClipIndexes,
  status,
}: GenerationStoryboardProps) {
  const shots = storyboard.shots;
  const completedKey = [...completedClipIndexes].sort((a, b) => a - b).join(",");
  const completedSet = new Set(completedClipIndexes);
  const initialPendingIndex = shots.findIndex((shot) => !completedSet.has(shot.index));
  const [activeIndex, setActiveIndex] = useState(() => Math.max(0, initialPendingIndex));

  useEffect(() => {
    if (shots.length < 2) return;
    const id = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % shots.length);
    }, ROTATE_MS);
    return () => window.clearInterval(id);
  }, [shots.length]);

  useEffect(() => {
    if (shots.length === 0) return;
    const completed = new Set(
      completedKey
        .split(",")
        .filter(Boolean)
        .map(Number),
    );
    const firstPending = shots.findIndex((shot) => !completed.has(shot.index));
    setActiveIndex(firstPending >= 0 ? firstPending : Math.max(0, shots.length - 1));
  }, [completedKey, shots.length]);

  if (shots.length === 0) return null;

  const activeShot = shots[activeIndex] ?? shots[0]!;
  const completed = Math.min(completedSet.size, storyboard.numClips);
  const energyPercent = Math.round(Math.max(0, Math.min(1, activeShot.energy)) * 100);

  return (
    <section
      aria-label="Generation storyboard"
      className="overflow-hidden rounded-xl border border-primary/20 bg-gradient-to-br from-primary/[0.08] via-card to-accent/[0.06]"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 px-4 py-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Clapperboard className="h-4 w-4 text-primary" />
            Your video storyboard
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{stageCopy(status)}</p>
        </div>
        <div className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs text-primary tabular-nums">
          {completed}/{storyboard.numClips} scenes rendered
        </div>
      </div>

      <div className="p-4">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeShot.index}
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            transition={{ duration: 0.3 }}
            className="grid gap-4 sm:grid-cols-[150px_1fr]"
          >
            <div className="flex min-h-32 flex-col justify-between rounded-lg border border-border/70 bg-background/50 p-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                  Scene {activeShot.index + 1}
                </span>
                {completedSet.has(activeShot.index) ? (
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-green-500/15 text-green-400">
                    <Check className="h-3 w-3" />
                  </span>
                ) : (
                  <Sparkles className="h-4 w-4 text-primary" />
                )}
              </div>
              <div>
                <p className="text-lg font-semibold capitalize">{activeShot.label}</p>
                <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock3 className="h-3.5 w-3.5" />
                  Starts near {timestamp(activeShot.startTime)}
                </div>
              </div>
              <div>
                <div className="mb-1 flex justify-between text-[10px] uppercase tracking-wide text-muted-foreground">
                  <span>Energy</span>
                  <span>{energyPercent}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${energyPercent}%` }}
                    className="h-full rounded-full bg-gradient-to-r from-primary to-accent"
                  />
                </div>
              </div>
            </div>

            <div className="flex min-w-0 flex-col justify-center">
              <p className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                Visual direction
              </p>
              <p className="mt-2 line-clamp-4 text-sm leading-relaxed text-foreground/90">
                {activeShot.prompt}
              </p>
              {storyboard.approximate && (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Timing is approximate until audio analysis finishes.
                </p>
              )}
            </div>
          </motion.div>
        </AnimatePresence>

        <div className="mt-4 flex gap-1.5 overflow-x-auto pb-1" aria-label="Storyboard scenes">
          {shots.map((shot, index) => (
            <button
              key={shot.index}
              type="button"
              onClick={() => setActiveIndex(index)}
              aria-label={`Show scene ${shot.index + 1}: ${shot.label}`}
              aria-current={index === activeIndex ? "step" : undefined}
              className={`h-2 min-w-6 flex-1 rounded-full transition-colors ${
                index === activeIndex
                  ? "bg-primary"
                  : completedSet.has(shot.index)
                    ? "bg-green-500/70"
                    : "bg-muted hover:bg-muted-foreground/40"
              }`}
            />
          ))}
        </div>
      </div>
    </section>
  );
}