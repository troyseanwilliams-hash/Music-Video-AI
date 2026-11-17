// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { probeVideo } from "./probeVideo";

let video: HTMLVideoElement;
beforeEach(() => {
  vi.useFakeTimers();
  video = document.createElement("video");
  vi.spyOn(video, "load").mockImplementation(() => {});
  const original = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation(((tag: string) => tag === "video" ? video : original(tag)) as typeof document.createElement);
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
function metadata(duration: number) {
  Object.defineProperties(video, {
    duration: { configurable: true, value: duration },
    videoWidth: { configurable: true, value: 1920 },
    videoHeight: { configurable: true, value: 1080 },
  });
  video.dispatchEvent(new Event("loadedmetadata"));
}
describe("Montage video probing", () => {
  it("preserves full MOV duration when no thumbnail/data event arrives", async () => {
    const result = probeVideo("blob:fixture");
    metadata(127.42);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(result).resolves.toEqual({ duration: 127.42, thumb: null });
    expect(video.load).toHaveBeenCalled();
    expect(video.getAttribute("src")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("rejects decoding errors instead of guessing three seconds", async () => {
    const result = probeVideo("blob:unsupported");
    const assertion = expect(result).rejects.toThrow("H.264");
    video.dispatchEvent(new Event("error"));
    await assertion;
    expect(video.onerror).toBeNull();
    expect(video.load).toHaveBeenCalled();
  });
  it("times out a stalled read rather than hanging forever", async () => {
    const result = probeVideo("blob:stalled", 200);
    const assertion = expect(result).rejects.toThrow("Timed out");
    await vi.advanceTimersByTimeAsync(200);
    await assertion;
    expect(video.onloadedmetadata).toBeNull();
  });
  it.each([0, NaN, Infinity])("does not accept invalid duration %s", async (duration) => {
    const result = probeVideo("blob:invalid");
    const assertion = expect(result).rejects.toThrow("couldn't read");
    metadata(duration);
    await assertion;
  });
});
