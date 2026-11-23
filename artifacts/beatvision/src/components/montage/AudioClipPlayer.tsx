import { useEffect, useRef, useState } from "react";
import { clamp, storageUrl } from "./overlayTypes";
import { audioClipGain, audioClipPlayback, type AudioClip } from "./audioClipTypes";

function ClipAudio({
  clip, timeSec, playing, onSourceDuration, onSourceError,
}: {
  onSourceError?: (objectPath: string) => void;
  clip: AudioClip;
  timeSec: number;
  playing: boolean;
  onSourceDuration?: (objectPath: string, sec: number) => void;
}) {
  const ref = useRef<HTMLAudioElement>(null);
  const cbRef = useRef(onSourceDuration);
  cbRef.current = onSourceDuration;
  const errRef = useRef(onSourceError);
  errRef.current = onSourceError;
  const { active, sourceSec } = audioClipPlayback(clip, timeSec);
  const gain = audioClipGain(clip, timeSec);

  useEffect(() => {
    const a = ref.current;
    if (!a) return undefined;
    a.volume = Number.isFinite(gain) ? clamp(gain, 0, 1) : 0;
    a.muted = clip.volume <= 0;
    if (!active || !playing) {
      if (!a.paused) a.pause();
      // Park at the right source position so play starts without a jump.
      if (active && a.readyState >= 1 && Math.abs(a.currentTime - sourceSec) > 0.04) {
        try { a.currentTime = sourceSec; } catch { /* not seekable yet */ }
      }
      return undefined;
    }
    const sync = () => {
      if (a.readyState >= 1 && Math.abs(a.currentTime - sourceSec) > 0.2) {
        try { a.currentTime = sourceSec; } catch { /* not seekable yet */ }
      }
      if (a.paused) {
        a.play().catch((err: unknown) => {
          // Autoplay-policy rejections are not source failures.
          if ((err as { name?: string } | null)?.name !== "NotAllowedError" && (err as { name?: string } | null)?.name !== "AbortError") {
            errRef.current?.(clip.objectPath);
          }
        });
      }
    };
    sync();
    if (a.readyState < 1) {
      a.addEventListener("loadedmetadata", sync);
      return () => a.removeEventListener("loadedmetadata", sync);
    }
    return undefined;
  }, [active, playing, sourceSec, gain, clip.volume, clip.objectPath]);

  useEffect(() => () => { ref.current?.pause(); }, []);

  return (
    <audio
      ref={ref}
      src={storageUrl(clip.objectPath)}
      preload="metadata"
      onLoadedMetadata={(e) => {
        const d = e.currentTarget.duration;
        if (Number.isFinite(d) && d > 0) cbRef.current?.(clip.objectPath, d);
      }}
      onError={() => errRef.current?.(clip.objectPath)}
      data-testid={`audio-clip-player-${clip.id}`}
    />
  );
}

/**
 * Invisible audio layer for timed music clips. Plays only while the editor
 * preview plays; the timeline clock (seek/pause/end) is the single source of
 * truth. Interpolates between the clock's coarse ticks for tight starts.
 */
export function AudioClipPlayer({
  clips, timeSec, playing, onSourceDuration, onSourceError, onUnderlyingMuteChange,
}: {
  onUnderlyingMuteChange?: (muted: boolean) => void;
  onSourceError?: (objectPath: string) => void;
  clips: AudioClip[];
  timeSec: number;
  playing: boolean;
  onSourceDuration?: (objectPath: string, sec: number) => void;
}) {
  const anchor = useRef({ time: timeSec, at: performance.now() });
  const [clock, setClock] = useState(timeSec);
  useEffect(() => {
    anchor.current = { time: timeSec, at: performance.now() };
    setClock(timeSec);
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      const elapsed = Math.min(0.4, (performance.now() - anchor.current.at) / 1000);
      setClock(anchor.current.time + elapsed);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [timeSec, playing]);
  const muteUnderlying = clips.some((clip) => !!clip.objectPath && clip.volume > 0 && audioClipPlayback(clip, clock).active);
  useEffect(() => {
    onUnderlyingMuteChange?.(muteUnderlying);
  }, [muteUnderlying, onUnderlyingMuteChange]);
  if (clips.length === 0) return null;
  return (
    <div className="hidden" aria-hidden="true" data-testid="audio-clip-player">
      {clips.filter((c) => !!c.objectPath).map((c) => (
        <ClipAudio key={c.id} clip={c} timeSec={clock} playing={playing} onSourceDuration={onSourceDuration} onSourceError={onSourceError} />
      ))}
    </div>
  );
}
