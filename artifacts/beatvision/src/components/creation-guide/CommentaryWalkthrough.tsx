import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Crosshair, Layers, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { revealThen } from "@/components/montage/editorTabs";
import { COMMENTARY_GUIDE_STEPS, clampCommentaryStep } from "./commentaryGuide";

export function CommentaryWalkthrough({ onClose }: { onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const [missing, setMissing] = useState(false);
  const step = COMMENTARY_GUIDE_STEPS[index];
  const last = index === COMMENTARY_GUIDE_STEPS.length - 1;

  useEffect(() => { setMissing(false); }, [index]);

  const jump = () => {
    const el = document.querySelector<HTMLElement>(step.target);
    if (!el) { setMissing(true); return; }
    setMissing(false);
    // Activate the editor tab holding a hidden target before scrolling to it.
    revealThen(el, () => el.scrollIntoView({ behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" }));
    el.classList.add("montage-guide-highlight");
    window.setTimeout(() => el.classList.remove("montage-guide-highlight"), 2200);
  };

  return (
    <aside
      role="dialog"
      aria-label="Commentary walkthrough"
      className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] left-4 right-4 z-40 rounded-xl border border-primary/30 bg-card/95 p-4 shadow-glow backdrop-blur sm:left-6 sm:right-auto sm:w-[22rem]"
      data-testid="commentary-walkthrough"
    >
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 text-xs font-medium text-primary">
          <Layers className="h-4 w-4" />
          Commentary walkthrough
          <span className="text-muted-foreground" data-testid="text-commentary-step">Step {index + 1} of {COMMENTARY_GUIDE_STEPS.length}</span>
        </div>
        <Button size="icon" variant="ghost" className="h-8 w-8 -mr-2 -mt-1" aria-label="Close walkthrough" onClick={onClose} data-testid="button-commentary-close">
          <X className="h-4 w-4" />
        </Button>
      </div>
      <h2 className="text-base font-semibold" data-testid="text-commentary-title">{step.title}</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
      <button type="button" onClick={jump} className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline" data-testid="button-commentary-show">
        <Crosshair className="h-3.5 w-3.5" /> Show me: {step.control}
      </button>
      {missing && <p role="status" className="mt-1 text-xs text-muted-foreground" data-testid="text-commentary-missing">{step.missingHint}</p>}
      <div className="mt-4 flex items-center justify-between gap-2">
        <Button size="sm" variant="ghost" onClick={() => setIndex(0)} disabled={index === 0} data-testid="button-commentary-restart">
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Restart
        </Button>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setIndex((i) => clampCommentaryStep(i - 1))} disabled={index === 0} data-testid="button-commentary-back">
            <ChevronLeft className="mr-1 h-4 w-4" /> Back
          </Button>
          {last ? (
            <Button size="sm" onClick={onClose} data-testid="button-commentary-finish">Finish</Button>
          ) : (
            <Button size="sm" onClick={() => setIndex((i) => clampCommentaryStep(i + 1))} data-testid="button-commentary-next">
              Next <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </aside>
  );
}
