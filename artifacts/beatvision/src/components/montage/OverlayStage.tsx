import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { clamp, containPosition, isActiveAt, isImageOverlay, storageUrl, type TextCard, type VideoOverlay } from "./overlayTypes";

// Keeps a <video> element locked to the editor's timeline clock. The editor's
// clock (progress * totalDuration) is the single source of truth: seek, pause
// and end all flow through timeSec/playing.
function useClockSync(
  ref: React.RefObject<HTMLVideoElement | null>,
  overlay: VideoOverlay,
  timeSec: number,
  playing: boolean,
  active: boolean,
  volume: number | null,
) {
  useEffect(() => {
    const v = ref.current;
    if (!v) return undefined;
    if (volume === null) {
      v.muted = true;
    } else {
      v.volume = clamp(volume, 0, 1);
      v.muted = volume <= 0;
    }
    if (!active) {
      if (!v.paused) v.pause();
      return undefined;
    }
    const sync = () => {
      const local = overlay.trimStart + (timeSec - overlay.startSec);
      const tolerance = playing ? 0.15 : 0.04;
      if (v.readyState >= 1 && Math.abs(v.currentTime - local) > tolerance) {
        try { v.currentTime = Math.max(0, local); } catch { /* metadata not ready */ }
      }
      if (playing && v.paused) v.play().catch(() => {});
      if (!playing && !v.paused) v.pause();
    };
    sync();
    // Seeking before metadata is a no-op; re-run once it arrives.
    if (v.readyState < 1) {
      v.addEventListener("loadedmetadata", sync);
      return () => v.removeEventListener("loadedmetadata", sync);
    }
    return undefined;
  }, [ref, overlay.trimStart, overlay.startSec, timeSec, playing, active, volume]);
}

type DragMode = "move" | "resize";

function OverlayBox({
  overlay, timeSec, playing, selected, stageH, onSelect, onChange, stageRef,
}: {
  overlay: VideoOverlay;
  timeSec: number;
  playing: boolean;
  selected: boolean;
  stageH: number;
  onSelect: () => void;
  onChange: (patch: Partial<VideoOverlay>) => void;
  stageRef: React.RefObject<HTMLDivElement | null>;
}) {
  const active = isActiveAt(overlay, timeSec);
  const isImage = isImageOverlay(overlay);
  const mainRef = useRef<HTMLVideoElement>(null);
  const blurRef = useRef<HTMLVideoElement>(null);
  const drag = useRef<null | { mode: DragMode; px: number; py: number; o: VideoOverlay }>(null);
  useClockSync(mainRef, overlay, timeSec, playing, active, overlay.volume);
  useClockSync(blurRef, overlay, timeSec, playing, active && (overlay.layout === "commentary" || overlay.layout === "center16x9"), null);

  const isCommentary = overlay.layout === "commentary" || overlay.layout === "center16x9";
  const down = (mode: DragMode) => (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    onSelect();
    // Commentary is always full-frame in the export; geometry is locked.
    if (isCommentary) return;
    drag.current = { mode, px: e.clientX, py: e.clientY, o: overlay };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const rect = stageRef.current?.getBoundingClientRect();
    if (!d || !rect) return;
    const dx = (e.clientX - d.px) / rect.width;
    const dy = (e.clientY - d.py) / rect.height;
    if (d.mode === "move") {
      onChange({
        x: clamp(d.o.x + dx, 0, 1 - d.o.width),
        y: clamp(d.o.y + dy, 0, 1 - d.o.height),
        layout: "custom",
      });
    } else {
      // Uniform scale keeps the box (and the contained clip) aspect ratio.
      const scale = Math.max((d.o.width + dx) / d.o.width, (d.o.height + dy) / d.o.height);
      const maxScale = Math.min((1 - d.o.x) / d.o.width, (1 - d.o.y) / d.o.height);
      const minScale = Math.max(0.05 / d.o.width, 0.05 / d.o.height);
      const s = clamp(scale, minScale, maxScale);
      onChange({ width: d.o.width * s, height: d.o.height * s, layout: "custom" });
    }
  };
  const up = (e: ReactPointerEvent<HTMLDivElement>) => {
    drag.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  };

  const src = storageUrl(overlay.objectPath);
  const box = isCommentary ? { x: 0, y: 0, width: 1, height: 1 } : overlay;
  const radius = overlay.cornerRadius * stageH;
  const border = overlay.borderWidth * stageH;

  return (
    <>
      {isCommentary && isImage && (
        <img
          src={storageUrl(overlay.objectPath)}
          alt=""
          aria-hidden="true"
          draggable={false}
          className="pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover blur-xl"
          style={{ visibility: active ? "visible" : "hidden" }}
        />
      )}
      {isCommentary && !isImage && (
        <video
          ref={blurRef}
          src={src}
          muted
          playsInline
          preload="metadata"
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover blur-xl"
          style={{ visibility: active ? "visible" : "hidden" }}
        />
      )}
      <div
        className={`absolute touch-none ${selected ? "outline outline-2 outline-offset-2 outline-primary" : ""}`}
        style={{
          left: overlay.layout === "center16x9" ? "50%" : `${box.x * 100}%`,
          top: overlay.layout === "center16x9" ? "50%" : `${box.y * 100}%`,
          width: overlay.layout === "center16x9" ? `min(100%, ${(stageRef.current?.clientHeight ?? 0) * (16 / 9)}px)` : `${box.width * 100}%`,
          height: overlay.layout === "center16x9" ? "auto" : `${box.height * 100}%`,
          ...(overlay.layout === "center16x9" ? { aspectRatio: "16 / 9", transform: "translate(-50%, -50%)" } : {}),
          // Rounding and border sit on the normalized box boundary (matching
          // the renderer), inset so the box geometry never changes.
          borderRadius: radius,
          overflow: "hidden",
          visibility: active ? "visible" : "hidden",
          pointerEvents: active ? "auto" : "none",
          cursor: isCommentary ? "pointer" : "move",
        }}
        onPointerDown={down("move")}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        data-testid={`preview-overlay-${overlay.id}`}
      >
        {isImage ? (
          <img
            src={src}
            alt={overlay.name}
            draggable={false}
            className="pointer-events-none absolute inset-0 h-full w-full object-contain"
            data-testid={`preview-overlay-image-${overlay.id}`}
          />
        ) : (
          <video
            ref={mainRef}
            src={src}
            playsInline
            preload="metadata"
            className="pointer-events-none absolute inset-0 h-full w-full object-contain"
          />
        )}
        {border > 0 && (
          <div className="pointer-events-none absolute inset-0" style={{ borderRadius: radius, boxShadow: `inset 0 0 0 ${border}px ${overlay.borderColor}` }} />
        )}
        {selected && !isCommentary && (
          <div
            onPointerDown={down("resize")}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
            className="absolute bottom-0 right-0 h-5 w-5 cursor-nwse-resize rounded-sm border-2 border-white bg-primary shadow"
            aria-label="Resize overlay"
            role="presentation"
          />
        )}
      </div>
    </>
  );
}

function TextCardBox({
  card, timeSec, selected, stageH, onSelect, onChange, stageRef,
}: {
  card: TextCard;
  timeSec: number;
  selected: boolean;
  stageH: number;
  onSelect: () => void;
  onChange: (patch: Partial<TextCard>) => void;
  stageRef: React.RefObject<HTMLDivElement | null>;
}) {
  const drag = useRef<null | { px: number; py: number; x: number; y: number }>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const active = isActiveAt(card, timeSec);
  useLayoutEffect(() => {
    const el = boxRef.current;
    const stage = stageRef.current;
    if (!el || !stage || !stage.clientWidth || !stage.clientHeight) return;
    const w = el.offsetWidth / stage.clientWidth;
    const h = el.offsetHeight / stage.clientHeight;
    if (Math.abs(w - size.w) > 0.001 || Math.abs(h - size.h) > 0.001) setSize({ w, h });
  });
  if (!active) return null;
  // Shared rule with export: manual newlines only, no automatic wrapping, and
  // the card is kept inside the frame where it fits.
  const pos = containPosition(card.x, card.y, size.w, size.h);
  return (
    <div
      ref={boxRef}
      className={`absolute touch-none whitespace-pre rounded-md px-[0.6em] py-[0.3em] font-semibold leading-tight ${selected ? "outline outline-2 outline-offset-2 outline-primary" : ""}`}
      style={{
        left: `${pos.x * 100}%`,
        top: `${pos.y * 100}%`,
        fontSize: Math.max(6, card.fontSize * stageH),
        color: card.color,
        backgroundColor: card.backgroundColor,
        pointerEvents: "auto",
        cursor: "move",
      }}
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onSelect();
        drag.current = { px: e.clientX, py: e.clientY, x: card.x, y: card.y };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        const rect = stageRef.current?.getBoundingClientRect();
        if (!d || !rect) return;
        onChange({
          x: clamp(d.x + (e.clientX - d.px) / rect.width, 0, 0.98),
          y: clamp(d.y + (e.clientY - d.py) / rect.height, 0, 0.98),
        });
      }}
      onPointerUp={(e) => { drag.current = null; e.currentTarget.releasePointerCapture?.(e.pointerId); }}
      onPointerCancel={() => { drag.current = null; }}
      data-testid={`preview-textcard-${card.id}`}
    >
      {card.text || " "}
    </div>
  );
}

export function OverlayStage({
  overlays, textCards, timeSec, playing, selectedId, onSelect, onChangeOverlay, onChangeText, muted = false,
}: {
  muted?: boolean;
  overlays: VideoOverlay[];
  textCards: TextCard[];
  timeSec: number;
  playing: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onChangeOverlay: (id: string, patch: Partial<VideoOverlay>) => void;
  onChangeText: (id: string, patch: Partial<TextCard>) => void;
}) {
  const layerRef = useRef<HTMLDivElement>(null);
  const [stageH, setStageH] = useState(0);
  // The main clock updates at the media element's timeupdate rate (~4Hz).
  // Interpolate between ticks with performance.now() so overlays and text
  // cards track the main video within a frame or two instead of ~250ms.
  const anchor = useRef({ time: timeSec, at: performance.now() });
  const [clock, setClock] = useState(timeSec);
  useEffect(() => {
    anchor.current = { time: timeSec, at: performance.now() };
    setClock(timeSec);
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      // Never run more than 0.4s ahead of the last real tick (stalls/buffering).
      const elapsed = Math.min(0.4, (performance.now() - anchor.current.at) / 1000);
      setClock(anchor.current.time + elapsed);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [timeSec, playing]);
  useEffect(() => {
    const el = layerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setStageH(el.clientHeight));
    ro.observe(el);
    setStageH(el.clientHeight);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={layerRef} className="pointer-events-none absolute inset-0 overflow-hidden" style={{ zIndex: 20 }}>
      {overlays.map((o) => (
        <OverlayBox
          key={o.id}
          overlay={muted ? { ...o, volume: 0 } : o}
          timeSec={clock}
          playing={playing}
          selected={selectedId === o.id}
          stageH={stageH}
          stageRef={layerRef}
          onSelect={() => onSelect(o.id)}
          onChange={(patch) => onChangeOverlay(o.id, patch)}
        />
      ))}
      {textCards.map((c) => (
        <TextCardBox
          key={c.id}
          card={c}
          timeSec={clock}
          selected={selectedId === c.id}
          stageH={stageH}
          stageRef={layerRef}
          onSelect={() => onSelect(c.id)}
          onChange={(patch) => onChangeText(c.id, patch)}
        />
      ))}
    </div>
  );
}
