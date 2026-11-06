import type { ReactNode } from "react";
import type { StarterAudioChoice } from "@/lib/starterVideo";

/** Silent renders have no audio, so they are exempt from the rights attestation. */
export function starterRightsRequired(audio: StarterAudioChoice): boolean {
  return audio !== "silent";
}

/** The exact acceptCopyright value sent on the job request. Never defaults to true for audio. */
export function resolveAcceptCopyright(hasAudio: boolean, acknowledged: boolean): boolean {
  return hasAudio ? acknowledged === true : true;
}

export function starterCanProceed(opts: {
  audio: StarterAudioChoice;
  rightsAccepted: boolean;
  otherwiseReady: boolean;
}): boolean {
  if (!opts.otherwiseReady) return false;
  return !starterRightsRequired(opts.audio) || opts.rightsAccepted;
}

/**
 * Starter cost-step gate: explicit, unchecked-by-default audio-rights attestation
 * (bound to the same state the job request uses) plus the proceed button.
 */
export function StarterRightsGate({
  audio,
  rightsAccepted,
  onRightsChange,
  otherwiseReady,
  onProceed,
  children,
}: {
  audio: StarterAudioChoice;
  rightsAccepted: boolean;
  onRightsChange: (accepted: boolean) => void;
  otherwiseReady: boolean;
  onProceed: () => void;
  children: ReactNode;
}) {
  const required = starterRightsRequired(audio);
  const canProceed = starterCanProceed({ audio, rightsAccepted, otherwiseReady });
  return (
    <div className="space-y-3">
      {required && (
        <label htmlFor="starter-rights" className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/60 bg-background/50 p-3">
          <input
            id="starter-rights"
            type="checkbox"
            checked={rightsAccepted}
            onChange={(e) => onRightsChange(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-primary"
            aria-required="true"
            data-testid="checkbox-starter-rights"
          />
          <span className="text-xs leading-relaxed text-muted-foreground">
            I confirm I have the right to use this audio (owned, licensed, or royalty-free).
          </span>
        </label>
      )}
      <button
        type="button"
        onClick={onProceed}
        disabled={!canProceed}
        className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-gradient-electric px-4 text-sm font-medium text-white shadow-glow disabled:pointer-events-none disabled:opacity-50 sm:w-auto"
        data-testid="button-starter-storyboard"
      >
        {children}
      </button>
    </div>
  );
}
