import { useState, type ReactNode } from "react";
import { Lightbulb, X } from "lucide-react";

const DISABLE_KEY = "abs_tutorials_disabled";
const tipKey = (id: string) => `abs_tip_${id}`;

export function tutorialsEnabled(): boolean {
  try {
    return localStorage.getItem(DISABLE_KEY) !== "1";
  } catch {
    return true;
  }
}

export function setTutorialsEnabled(on: boolean): void {
  try {
    if (on) localStorage.removeItem(DISABLE_KEY);
    else localStorage.setItem(DISABLE_KEY, "1");
  } catch {
    /* ignore */
  }
}

/**
 * A dismissible in-app tip. Hidden when the user has turned off tips globally,
 * or has dismissed this specific tip (both persisted in localStorage).
 */
export function TutorialTip({ id, title, children }: { id: string; title?: string; children: ReactNode }) {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return !tutorialsEnabled() || localStorage.getItem(tipKey(id)) === "1";
    } catch {
      return false;
    }
  });

  if (dismissed) return null;

  const dismiss = () => {
    try { localStorage.setItem(tipKey(id), "1"); } catch { /* ignore */ }
    setDismissed(true);
  };
  const disableAll = () => {
    setTutorialsEnabled(false);
    setDismissed(true);
  };

  return (
    <div className="relative rounded-xl border border-primary/25 bg-primary/[0.06] p-3.5 pr-9 text-sm">
      <button onClick={dismiss} className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground" aria-label="Dismiss tip">
        <X className="h-4 w-4" />
      </button>
      <div className="flex gap-2.5">
        <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div>
          {title && <p className="font-medium">{title}</p>}
          <div className="text-muted-foreground">{children}</div>
          <button onClick={disableAll} className="mt-1.5 text-xs text-muted-foreground underline hover:text-foreground">
            Turn off tips
          </button>
        </div>
      </div>
    </div>
  );
}
