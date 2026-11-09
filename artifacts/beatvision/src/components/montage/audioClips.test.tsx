// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
vi.mock("./audioClipTypes", async (orig) => ({
  ...(await orig<typeof import("./audioClipTypes")>()),
  probeAudioDuration: vi.fn(async () => 30),
}));
import { probeAudioDuration } from "./audioClipTypes";
import { AudioClipPlayer } from "./AudioClipPlayer";
import { AudioClipPanel } from "./AudioClipPanel";
import { AudioClipTimeline } from "./AudioClipTimeline";
import {
  audioClipPlayback, fitAudioDuration, normalizeAudioClipList, serializeAudioClips, validateAudioClips, type AudioClip,
} from "./audioClipTypes";

const clip = (over: Partial<AudioClip> = {}): AudioClip => ({
  id: "a1", name: "Intro song", objectPath: "/objects/uploads/song", startSec: 0, durationSec: 5, trimStart: 12, volume: 0.6, ...over,
});

describe("audio clip data", () => {
  it("roundtrips exactly through JSON and treats legacy absent as empty", () => {
    const clips = [clip(), clip({ id: "a2", startSec: 30.25, durationSec: 8.5, trimStart: 0, volume: 1 })];
    const restored = normalizeAudioClipList(JSON.parse(JSON.stringify({ audioClips: serializeAudioClips(clips) })).audioClips);
    expect(restored).toEqual(clips);
    expect(JSON.stringify(serializeAudioClips(restored))).toBe(JSON.stringify(serializeAudioClips(clips)));
    expect(normalizeAudioClipList(undefined)).toEqual([]);
    const [noMedia] = normalizeAudioClipList([{ id: "x", name: "no media", startSec: 1, durationSec: 2, trimStart: 0, volume: 0.5 }]);
    expect(noMedia!.objectPath).toBe("");
    expect(validateAudioClips([noMedia!], 60)[0]?.message).toMatch(/missing its song file/);
  });

  it("preserves finite out-of-range values exactly and reports them", () => {
    const [c] = normalizeAudioClipList([{ id: "o", name: "Big", objectPath: "/objects/s", startSec: 1900, durationSec: 1801, trimStart: 2000, volume: 1.4 }]);
    expect(c).toMatchObject({ startSec: 1900, durationSec: 1801, trimStart: 2000, volume: 1.4 });
    const msgs = validateAudioClips([c!], 1800).map((i) => i.message).join("\n");
    expect(msgs).toMatch(/starts after the 30:00 limit/);
    expect(msgs).toMatch(/longer than the 30:00 limit/);
    expect(msgs).toMatch(/offset is beyond 30:00/);
    expect(msgs).toMatch(/volume/);
    const [bad] = normalizeAudioClipList([{ id: "n", name: "Bad", objectPath: "/objects/s", startSec: "soon" }]);
    expect(validateAudioClips([bad!], 60)[0]?.message).toMatch(/invalid number/);
  });

  it("validates timeline end, source length, overlap and count", () => {
    expect(validateAudioClips([clip()], 60, { "/objects/uploads/song": 30 })).toEqual([]);
    expect(validateAudioClips([clip({ startSec: 58 })], 60)[0]?.message).toMatch(/after the main video ends/);
    expect(validateAudioClips([clip({ trimStart: 28 })], 60, { "/objects/uploads/song": 30 })[0]?.message).toMatch(/only 2.00s/);
    expect(validateAudioClips([clip({ trimStart: 40 })], 60, { "/objects/uploads/song": 30 })[0]?.message).toMatch(/only/);
    const five = Array.from({ length: 5 }, (_, i) => clip({ id: `c${i}` }));
    expect(validateAudioClips(five, 60).some((i) => /at most 4/.test(i.message))).toBe(true);
    expect(validateAudioClips(five.slice(0, 4), 60)).toEqual([]);
    const many = Array.from({ length: 101 }, (_, i) => clip({ id: `m${i}`, startSec: i * 0.1, durationSec: 0.1 }));
    expect(validateAudioClips(many, 60).some((i) => /limit is 100/.test(i.message))).toBe(true);
  });

  it("maps timeline time to source time", () => {
    expect(audioClipPlayback(clip({ startSec: 10 }), 12.5)).toEqual({ active: true, sourceSec: 14.5 });
    expect(audioClipPlayback(clip({ startSec: 10 }), 15).active).toBe(false);
    expect(fitAudioDuration(57, 0, 60)).toBe(3);
    expect(fitAudioDuration(0, 28, 60, 30)).toBe(2);
  });
});

describe("audio clip components", () => {
  let host: HTMLDivElement;
  let root: Root;
  let playSpy: ReturnType<typeof vi.spyOn>;
  let pauseSpy: ReturnType<typeof vi.spyOn>;
  let paused = true;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    paused = true;
    playSpy = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(async () => { paused = false; });
    pauseSpy = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => { paused = true; });
    vi.spyOn(HTMLMediaElement.prototype, "paused", "get").mockImplementation(() => paused);
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:x", revokeObjectURL: () => {} }));
    vi.spyOn(HTMLMediaElement.prototype, "readyState", "get").mockReturnValue(1);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("never plays before play, then seeks to the source offset with the clip volume", () => {
    const c = clip({ startSec: 10 });
    act(() => root.render(<AudioClipPlayer clips={[c]} timeSec={12} playing={false} />));
    const audio = host.querySelector("audio")!;
    expect(playSpy).not.toHaveBeenCalled();
    expect(audio.currentTime).toBeCloseTo(14);
    act(() => root.render(<AudioClipPlayer clips={[c]} timeSec={12} playing />));
    expect(playSpy).toHaveBeenCalledTimes(1);
    expect(audio.volume).toBeCloseTo(0.6);
    act(() => root.render(<AudioClipPlayer clips={[c]} timeSec={13.5} playing />));
    expect(audio.currentTime).toBeCloseTo(15.5);
    expect(paused).toBe(false);
    // Pause from the timeline.
    act(() => root.render(<AudioClipPlayer clips={[c]} timeSec={13.5} playing={false} />));
    expect(pauseSpy).toHaveBeenCalled();
    expect(paused).toBe(true);
    // Resume, then seek past the clip end while playing: it must stop.
    act(() => root.render(<AudioClipPlayer clips={[c]} timeSec={13.5} playing />));
    expect(paused).toBe(false);
    playSpy.mockClear();
    act(() => root.render(<AudioClipPlayer clips={[c]} timeSec={15} playing />));
    expect(paused).toBe(true);
    expect(playSpy).not.toHaveBeenCalled();
    // Timeline end: playing flips off.
    act(() => root.render(<AudioClipPlayer clips={[c]} timeSec={60} playing={false} />));
    expect(paused).toBe(true);
  });

  it("reports unreadable sources", () => {
    const onErr = vi.fn();
    act(() => root.render(<AudioClipPlayer clips={[clip()]} timeSec={0} playing={false} onSourceError={onErr} />));
    act(() => { host.querySelector("audio")!.dispatchEvent(new Event("error")); });
    expect(onErr).toHaveBeenCalledWith("/objects/uploads/song");
  });

  it("discards an upload that finishes after a project switch", async () => {
    let clips: AudioClip[] = [];
    const setClips = vi.fn((next: AudioClip[] | ((p: AudioClip[]) => AudioClip[])) => {
      clips = typeof next === "function" ? next(clips) : next;
    });
    let resolveUpload: (p: string) => void = () => {};
    const uploadFile = () => new Promise<string>((res) => { resolveUpload = res; });
    const pending = vi.fn();
    const qc = new QueryClient();
    const render = (epoch: number) => act(() => root.render(
      <QueryClientProvider client={qc}>
        <AudioClipPanel
          clips={clips} setClips={setClips} selectedId={null} setSelectedId={() => {}}
          playheadSec={0} totalDuration={60} sourceDurations={{}} onSourceDuration={() => {}}
          uploadFile={uploadFile} issues={[]} epoch={epoch} onPendingChange={pending}
        />
      </QueryClientProvider>,
    ));
    render(0);
    const input = host.querySelector<HTMLInputElement>('[data-testid="input-audio-clip-file"]')!;
    const file = new File(["x"], "intro.mp3", { type: "audio/mpeg" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(host.querySelector('[data-testid="status-audio-clip-pending"]')).not.toBeNull();
    expect(pending).toHaveBeenLastCalledWith(true);
    render(1);
    expect(host.querySelector('[data-testid="status-audio-clip-pending"]')).toBeNull();
    expect(pending).toHaveBeenLastCalledWith(false);
    await act(async () => { resolveUpload("/objects/uploads/late"); await Promise.resolve(); });
    expect(setClips).not.toHaveBeenCalled();
    expect(clips).toEqual([]);
  });

  it("refuses to add a library song whose length cannot be read", async () => {
    vi.mocked(probeAudioDuration).mockResolvedValueOnce(null);
    const setClips = vi.fn();
    const qc = new QueryClient();
    act(() => root.render(
      <QueryClientProvider client={qc}>
        <AudioClipPanel
          clips={[]} setClips={setClips} selectedId={null} setSelectedId={() => {}}
          playheadSec={0} totalDuration={60} sourceDurations={{}} onSourceDuration={() => {}}
          uploadFile={async () => "/objects/x"} issues={[]} epoch={0}
          soundtrack={{ name: "Main", objectPath: "/objects/uploads/main" }}
        />
      </QueryClientProvider>,
    ));
    await act(async () => { host.querySelector<HTMLButtonElement>('[data-testid="button-reuse-soundtrack-clip"]')!.click(); });
    expect(setClips).not.toHaveBeenCalled();
  });

  it("edits, duplicates and deletes clips in the panel", () => {
    let clips = [clip()];
    const setClips = (next: AudioClip[] | ((p: AudioClip[]) => AudioClip[])) => {
      clips = typeof next === "function" ? next(clips) : next;
      render();
    };
    const qc = new QueryClient();
    const render = () => act(() => root.render(
      <QueryClientProvider client={qc}>
        <AudioClipPanel
          clips={clips} setClips={setClips} selectedId={null} setSelectedId={() => {}}
          playheadSec={20} totalDuration={60} sourceDurations={{}} onSourceDuration={() => {}}
          uploadFile={async () => "/objects/x"} issues={[]} epoch={0}
        />
      </QueryClientProvider>,
    ));
    render();
    const start = host.querySelector<HTMLInputElement>('[data-testid="input-audio-clip-start-a1"]')!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(start, "7.5");
      start.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(clips[0]!.startSec).toBe(7.5);
    act(() => host.querySelector<HTMLButtonElement>('[data-testid="button-audio-clip-at-playhead-a1"]')!.click());
    expect(clips[0]!.startSec).toBe(20);
    act(() => host.querySelector<HTMLButtonElement>('[data-testid="button-duplicate-audio-clip-a1"]')!.click());
    expect(clips).toHaveLength(2);
    expect(clips[1]!.objectPath).toBe(clips[0]!.objectPath);
    expect(clips[1]!.startSec).toBe(25);
    act(() => host.querySelector<HTMLButtonElement>('[data-testid="button-delete-audio-clip-a1"]')!.click());
    expect(clips.map((c) => c.id)).not.toContain("a1");
  });

  it("draws timeline bars", () => {
    act(() => root.render(
      <AudioClipTimeline clips={[clip({ startSec: 30, durationSec: 6 })]} totalDuration={60} playheadSec={0} selectedId={null} onSelect={() => {}} onSeek={() => {}} />,
    ));
    const bar = host.querySelector<HTMLElement>('[data-testid="timeline-audio-a1"]')!;
    expect(bar.style.width).toBe("10%");
  });
});
