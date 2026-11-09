import { describe, expect, it } from "vitest";
import {
  containPosition, MAX_OVERLAYS, normalizeOverlayList, normalizeTextCardList, validateLayers,
  type TextCard, type VideoOverlay,
} from "./overlayTypes";

const ov = (id: string, startSec: number, durationSec: number): VideoOverlay => ({
  id, name: id, objectPath: `/objects/${id}`, startSec, durationSec, trimStart: 0,
  x: 0.6, y: 0.1, width: 0.3, height: 0.4, layout: "reaction", volume: 0.25, cornerRadius: 0, borderWidth: 0, borderColor: "#ffffff",
});
const tc = (id: string, startSec: number, durationSec: number): TextCard => ({
  id, text: "Hi", startSec, durationSec, x: 0.1, y: 0.1, fontSize: 0.05, color: "#ffffff", backgroundColor: "#000000",
});

describe("manifest load", () => {
  it("treats legacy manifests as empty layers", () => {
    expect(normalizeOverlayList(undefined)).toEqual([]);
    expect(normalizeTextCardList(undefined)).toEqual([]);
  });
  it("round-trips saved layers unchanged", () => {
    const o = [ov("a", 1, 2)];
    const t = [tc("b", 0, 3)];
    expect(normalizeOverlayList(JSON.parse(JSON.stringify(o)))).toEqual(o);
    expect(normalizeTextCardList(JSON.parse(JSON.stringify(t)))).toEqual(t);
  });
  it("preserves over-long text on load and flags it", () => {
    const long = "x".repeat(600);
    const [card] = normalizeTextCardList([{ ...tc("t", 0, 1), text: long }]);
    expect(card!.text).toBe(long);
    expect(validateLayers([], [card!], 10).length).toBe(1);
  });
  it("flags blank text cards", () => {
    expect(validateLayers([], [{ ...tc("t", 0, 1), text: "  \n " }], 10).length).toBe(1);
  });
  it("does not silently truncate over-limit lists", () => {
    const many = Array.from({ length: MAX_OVERLAYS + 3 }, (_, i) => ov(`o${i}`, 0, 1));
    expect(normalizeOverlayList(many)).toHaveLength(MAX_OVERLAYS + 3);
  });
});

describe("validateLayers", () => {
  it("accepts layers ending within the tolerance", () => {
    expect(validateLayers([ov("a", 8, 2.04)], [tc("b", 9, 1.05)], 10)).toEqual([]);
  });
  it("rejects layers ending after the main timeline", () => {
    const issues = validateLayers([ov("a", 8, 2.1)], [tc("b", 9, 1.2)], 10);
    expect(issues.map((i) => i.id)).toEqual(["a", "b"]);
  });
  it("rejects more than four simultaneous overlays but allows back-to-back", () => {
    const four = [0, 1, 2, 3].map((i) => ov(`o${i}`, 0, 5));
    expect(validateLayers(four, [], 20)).toEqual([]);
    expect(validateLayers([...four, ov("x", 5, 2)], [], 20)).toEqual([]);
    expect(validateLayers([...four, ov("y", 4, 2)], [], 20).length).toBe(1);
  });
  it("reports caps", () => {
    const many = Array.from({ length: MAX_OVERLAYS + 1 }, (_, i) => ov(`o${i}`, i * 2, 1));
    expect(validateLayers(many, [], 1000).some((i) => i.id === null)).toBe(true);
  });
});

describe("containPosition", () => {
  it("keeps boxes inside the frame", () => {
    expect(containPosition(0.9, 0.95, 0.3, 0.2)).toEqual({ x: 0.7, y: 0.8 });
    expect(containPosition(0.2, 0.1, 1.4, 0.2)).toEqual({ x: 0, y: 0.1 });
  });
});
