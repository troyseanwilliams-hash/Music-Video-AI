// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OverlayStage } from "./OverlayStage";
import { OverlayTimeline, packLanes } from "./OverlayTimeline";
import { LAYOUT_PRESETS, type VideoOverlay } from "./overlayTypes";

const base: VideoOverlay = {
  id: "clip", name: "Reaction source", objectPath: "/objects/uploads/test/source",
  startSec: 1, durationSec: 2, trimStart: 3,
  ...LAYOUT_PRESETS.reactionRight, volume: 0.25,
  borderWidth: 0, borderColor: "#ffffff",
};

describe("Montage preview layers", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("ResizeObserver", class {
      observe() {} disconnect() {}
    });
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, "readyState", "get").mockReturnValue(1);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  function render(overlay: VideoOverlay, timeSec: number, playing = false) {
    return act(async () => root.render(
      <OverlayStage overlays={[overlay]} textCards={[]} timeSec={timeSec} playing={playing}
        selectedId={overlay.id} onSelect={() => {}} onChangeOverlay={() => {}} onChangeText={() => {}} />,
    ));
  }
  it("seeks the overlay to source trim plus the main timeline offset", async () => {
    await render(base, 1.5);
    const video = host.querySelector("video")!;
    expect(video.currentTime).toBeCloseTo(3.5, 2);
    expect(video.volume).toBe(0.25);
    expect(video.muted).toBe(false);
    await render(base, 2.5);
    expect(video.currentTime).toBeCloseTo(4.5, 2);
  });
  it("shows mixed image and video overlays only inside their own exact windows", async () => {
    const img: VideoOverlay = { ...base, id: "still", kind: "image", startSec: 2.25, durationSec: 1.5, trimStart: 0, volume: 0 };
    const renderBoth = (t: number) => act(async () => root.render(
      <OverlayStage overlays={[base, img]} textCards={[]} timeSec={t} playing={false}
        selectedId={null} onSelect={() => {}} onChangeOverlay={() => {}} onChangeText={() => {}} />,
    ));
    const vis = (id: string) => (host.querySelector(`[data-testid='preview-overlay-${id}']`) as HTMLElement).style.visibility;
    await renderBoth(1.5);
    expect([vis("clip"), vis("still")]).toEqual(["visible", "hidden"]);
    await renderBoth(2.5);
    expect([vis("clip"), vis("still")]).toEqual(["visible", "visible"]);
    await renderBoth(3.5);
    expect([vis("clip"), vis("still")]).toEqual(["hidden", "visible"]);
    await renderBoth(3.75);
    expect(vis("still")).toBe("hidden");
    expect(host.querySelectorAll("video").length).toBe(1);
    expect(host.querySelector("[data-testid='preview-overlay-image-still']")?.tagName).toBe("IMG");
  });
  it("hides overlays before and after their chosen interval", async () => {
    await render(base, 0);
    expect((host.querySelector("[data-testid='preview-overlay-clip']") as HTMLElement).style.visibility).toBe("hidden");
    await render(base, 1.5);
    expect((host.querySelector("[data-testid='preview-overlay-clip']") as HTMLElement).style.visibility).toBe("visible");
    await render(base, 3);
    expect((host.querySelector("[data-testid='preview-overlay-clip']") as HTMLElement).style.visibility).toBe("hidden");
  });
  it("uses a muted background copy and one audible commentary clip", async () => {
    await render({ ...base, ...LAYOUT_PRESETS.commentary }, 1.5, true);
    const videos = host.querySelectorAll("video");
    expect(videos.length).toBe(2);
    expect(videos[0]!.muted).toBe(true);
    expect(videos[1]!.muted).toBe(false);
    expect(videos[1]!.volume).toBe(0.25);
    expect(videos[0]!.currentTime).toBeCloseTo(videos[1]!.currentTime, 2);
    vi.spyOn(HTMLMediaElement.prototype, "paused", "get").mockReturnValue(false);
    await render({ ...base, ...LAYOUT_PRESETS.commentary, volume: 0 }, 1.7);
    expect(videos[1]!.muted).toBe(true);
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
  });
  it("shows manual-line-break text only during its interval", async () => {
    const props = {
      overlays: [], textCards: [{
        id: "card", text: "$2,900/month\nFact card", startSec: 1, durationSec: 2,
        x: 0.1, y: 0.1, fontSize: 0.05, color: "#ffffff", backgroundColor: "#000000",
      }],
      playing: false, selectedId: null, onSelect: () => {}, onChangeOverlay: () => {}, onChangeText: () => {},
    };
    await act(async () => root.render(<OverlayStage {...props} timeSec={0} />));
    expect(host.textContent).toBe("");
    await act(async () => root.render(<OverlayStage {...props} timeSec={1.5} />));
    expect(host.textContent).toBe("$2,900/month\nFact card");
    await act(async () => root.render(<OverlayStage {...props} timeSec={3} />));
    expect(host.textContent).toBe("");
  });
  it("puts overlapping clips in separate lanes without hiding back-to-back clips", () => {
    const lanes = packLanes([
      { startSec: 0, durationSec: 3 },
      { startSec: 1, durationSec: 1 },
      { startSec: 3, durationSec: 2 },
    ]);
    expect(lanes).toHaveLength(2);
    expect(lanes[0]).toHaveLength(2);
    expect(lanes[1]).toHaveLength(1);
  });
  it("selects and seeks timeline clips and supports keyboard timing adjustments", async () => {
    const select = vi.fn(), seek = vi.fn(), move = vi.fn();
    await act(async () => root.render(
      <OverlayTimeline overlays={[base]} textCards={[]} totalDuration={20}
        playheadSec={0} selectedId={null} onSelect={select} onSeek={seek}
        onMoveOverlay={move} onMoveText={() => {}} />,
    ));
    const button = host.querySelector("button")!;
    await act(async () => button.click());
    expect(select).toHaveBeenCalledWith(base.id);
    expect(seek).toHaveBeenCalledWith(1);
    await act(async () => button.dispatchEvent(new KeyboardEvent("keydown", {
      key: "ArrowRight", shiftKey: true, bubbles: true,
    })));
    expect(move).toHaveBeenCalledWith(base.id, 2);
    await act(async () => button.dispatchEvent(new KeyboardEvent("keydown", {
      key: "ArrowLeft", bubbles: true,
    })));
    expect(move).toHaveBeenLastCalledWith(base.id, 0.9);
  });
});
