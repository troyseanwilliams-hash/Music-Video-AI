import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, CircleHelp, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  deriveMontageGuideProgress,
  canContinueMontageStep,
  MONTAGE_GUIDE_EVENT,
  MONTAGE_GUIDE_STEPS,
  readMontageGuideProgress,
  restartMontageGuide,
  writeMontageGuideProgress,
  type MontageGuideProgress,
  type MontageGuideStep,
} from "@/lib/montageGuide";

interface MontageWalkthroughProps {
  accountId: string;
  hasAudio: boolean;
  hasMedia: boolean;
  arranged: boolean;
  previewPlayed: boolean;
  costSummary: string;
  onAcceptArrangement: () => void;
}

const COPY: Record<MontageGuideStep, { title: string; body: string; target: string }> = {
  audio: {
    title: "Add a soundtrack (optional)",
    body: "Choose your own track, a Suno link, or My Music. You can also continue without audio.",
    target: "audio",
  },
  media: {
    title: "Add ready photos or clips",
    body: "Use files that are ready now, or select finished work from Gallery or Generated images. Wait for uploads to finish before exporting.",
    target: "media",
  },
  arrange: {
    title: "Arrange the real timeline",
    body: "Drag items into order, then select one to adjust its photo hold time or video trim. Your draft stays exactly as you leave it.",
    target: "timeline",
  },
  preview: {
    title: "Play your preview",
    body: "Press Play and watch the actual timeline. This step completes only after playback really starts.",
    target: "preview",
  },
  export: {
    title: "Review, then export when ready",
    body: "Check the estimate below and confirm content rights. Exporting starts a real render; this guide will never click it or spend credits for you.",
    target: "export",
  },
};

export function MontageWalkthrough(props: MontageWalkthroughProps) {
  const context = useMemo(() => ({
    hasAudio: props.hasAudio,
    hasMedia: props.hasMedia,
    arranged: props.arranged,
    previewPlayed: props.previewPlayed,
  }), [props.hasAudio, props.hasMedia, props.arranged, props.previewPlayed]);
  const [progress, setProgress] = useState<MontageGuideProgress>(() => {
    const saved = readMontageGuideProgress(props.accountId);
    const force = typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("guide") === "montage";
    if (force && saved?.status === "submitted") {
      return restartMontageGuide(context);
    }
    const derived = deriveMontageGuideProgress(saved, context);
    return force ? { ...derived, status: "active" } : derived;
  });
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const resume = () => {
      setProgress((current) => {
        const next = current.status === "submitted"
          ? restartMontageGuide(context)
          : { ...deriveMontageGuideProgress(current, context), status: "active" as const };
        writeMontageGuideProgress(props.accountId, next);
        return next;
      });
      setCollapsed(false);
    };
    window.addEventListener(MONTAGE_GUIDE_EVENT, resume);
    return () => window.removeEventListener(MONTAGE_GUIDE_EVENT, resume);
  }, [context, props.accountId]);

  useEffect(() => {
    setProgress((current) => {
      const next = deriveMontageGuideProgress(current, context);
      writeMontageGuideProgress(props.accountId, next);
      return next;
    });
  }, [context, props.accountId]);

  const activeIndex = MONTAGE_GUIDE_STEPS.indexOf(progress.step);
  const copy = COPY[progress.step];
  useEffect(() => {
    if (progress.status !== "active" || collapsed) return;
    const target = document.querySelector<HTMLElement>(`[data-montage-guide="${copy.target}"]`);
    if (!target) return;
    target.classList.add("montage-guide-highlight");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
    return () => target.classList.remove("montage-guide-highlight");
  }, [copy.target, progress.status, collapsed]);

  const persist = (next: MontageGuideProgress) => {
    setProgress(next);
    writeMontageGuideProgress(props.accountId, next);
  };
  const canContinue = canContinueMontageStep(progress.step, context);

  if (progress.status === "submitted") return null;
  if (progress.status === "skipped") {
    return (
      <div className="mb-4 flex justify-end">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => persist({ ...progress, status: "active" })}
          data-testid="button-resume-montage-walkthrough"
        >
          <CircleHelp className="mr-2 h-4 w-4" /> Resume walkthrough
        </Button>
      </div>
    );
  }

  return (
    <section
      className="sticky top-2 z-20 mb-5 rounded-xl border border-primary/40 bg-background/95 p-3 shadow-lg backdrop-blur md:p-4"
      aria-label="Montage creation walkthrough"
      data-testid="panel-montage-walkthrough"
    >
      <div className="flex items-center gap-2">
        <CircleHelp className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-sm font-semibold">
          Montage walkthrough <span className="font-normal text-muted-foreground">· {activeIndex + 1} of {MONTAGE_GUIDE_STEPS.length}</span>
        </p>
        <Button type="button" size="sm" variant="ghost" onClick={() => setCollapsed((value) => !value)} data-testid="button-collapse-montage-walkthrough">
          <ChevronDown className={`h-4 w-4 transition-transform ${collapsed ? "-rotate-90" : ""}`} />
          <span className="sr-only">{collapsed ? "Expand" : "Collapse"} walkthrough</span>
        </Button>
        <Button type="button" size="sm" variant="ghost" aria-label="Skip walkthrough" onClick={() => persist({ ...progress, status: "skipped" })} data-testid="button-skip-montage-walkthrough">
          <X className="h-4 w-4 md:mr-1" /><span className="hidden md:inline">Skip</span>
        </Button>
      </div>
      {!collapsed && (
        <div className="mt-3 md:pl-7">
          <h2 className="font-semibold">{copy.title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{copy.body}</p>
          {progress.step === "export" && (
            <p className="mt-2 rounded-md bg-muted/50 px-3 py-2 text-sm font-medium" data-testid="text-montage-guide-cost">
              {props.costSummary} After you accept the export, follow its existing job progress page.
            </p>
          )}
          {progress.step === "arrange" && props.hasMedia && !props.arranged && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-3"
              onClick={props.onAcceptArrangement}
              data-testid="button-accept-current-montage-arrangement"
            >
              Use this order &amp; timing
            </Button>
          )}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={activeIndex === 0}
              onClick={() => persist({ ...progress, step: MONTAGE_GUIDE_STEPS[activeIndex - 1]! })}
              data-testid="button-back-montage-walkthrough"
            >
              <ChevronLeft className="mr-1 h-4 w-4" /> Back
            </Button>
            {progress.step !== "export" && (
              <Button
                type="button"
                size="sm"
                disabled={!canContinue}
                onClick={() => {
                  const completed = [...new Set([...progress.completed, progress.step])];
                  persist({ ...progress, completed, step: MONTAGE_GUIDE_STEPS[activeIndex + 1]! });
                }}
                data-testid="button-next-montage-walkthrough"
              >
                {progress.step === "audio" && !props.hasAudio ? "Continue without audio" : "Next"}
                <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}