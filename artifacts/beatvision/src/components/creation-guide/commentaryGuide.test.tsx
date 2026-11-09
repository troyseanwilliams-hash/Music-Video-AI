// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommentaryWalkthrough } from "./CommentaryWalkthrough";
import { COMMENTARY_GUIDE_STEPS, clampCommentaryStep, editorReturnTo, isCommentaryGuideRequested } from "./commentaryGuide";
import { RELEASE_NOTES } from "@/lib/whatsNew";
import { COMMENTARY_STEPS } from "@/pages/tutorial-script-to-video";

describe("commentary guide content", () => {
  it("detects the deep link and preserves it for sign-in", () => {
    expect(isCommentaryGuideRequested("?guide=commentary")).toBe(true);
    expect(isCommentaryGuideRequested("?guide=montage")).toBe(false);
    expect(editorReturnTo("?guide=commentary")).toBe("/editor?guide=commentary");
    expect(editorReturnTo("")).toBe("/editor");
  });
  it("clamps steps", () => {
    expect(clampCommentaryStep(-3)).toBe(0);
    expect(clampCommentaryStep(99)).toBe(COMMENTARY_GUIDE_STEPS.length - 1);
  });
  it("only claims supported limits and never 4K", () => {
    const all = JSON.stringify([COMMENTARY_GUIDE_STEPS, RELEASE_NOTES, COMMENTARY_STEPS]);
    expect(all).not.toMatch(/4K/i);
    expect(all).toMatch(/1080p/);
    expect(all).toMatch(/30 minutes/);
    expect(all).not.toMatch(/Visual Montage/);
    expect(all).not.toMatch(/all AI generation is free/i);
  });
  it("has a single dated release that links to real routes", () => {
    expect(RELEASE_NOTES).toHaveLength(1);
    expect(RELEASE_NOTES[0].date).toBe("November 9, 2026");
    for (const l of RELEASE_NOTES[0].links) expect(l.href).toMatch(/^\/(editor|tutorial\/script-to-video)/);
  });
});

describe("CommentaryWalkthrough", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); });

  const q = (id: string) => host.querySelector<HTMLElement>(`[data-testid="${id}"]`);

  it("navigates next, back, restart and close without touching the page", () => {
    const onClose = vi.fn();
    act(() => root.render(<CommentaryWalkthrough onClose={onClose} />));
    expect(q("text-commentary-step")?.textContent).toBe(`Step 1 of ${COMMENTARY_GUIDE_STEPS.length}`);
    act(() => q("button-commentary-next")!.click());
    act(() => q("button-commentary-next")!.click());
    expect(q("text-commentary-title")?.textContent).toBe(COMMENTARY_GUIDE_STEPS[2].title);
    act(() => q("button-commentary-back")!.click());
    expect(q("text-commentary-title")?.textContent).toBe(COMMENTARY_GUIDE_STEPS[1].title);
    act(() => q("button-commentary-show")!.click());
    expect(q("text-commentary-missing")?.textContent).toBe(COMMENTARY_GUIDE_STEPS[1].missingHint);
    act(() => q("button-commentary-restart")!.click());
    expect(q("text-commentary-title")?.textContent).toBe(COMMENTARY_GUIDE_STEPS[0].title);
    act(() => q("button-commentary-close")!.click());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("scrolls to an existing control", () => {
    const target = document.createElement("div");
    target.setAttribute("data-montage-guide", "media");
    target.scrollIntoView = vi.fn();
    document.body.appendChild(target);
    act(() => root.render(<CommentaryWalkthrough onClose={() => {}} />));
    act(() => q("button-commentary-show")!.click());
    expect(target.scrollIntoView).toHaveBeenCalled();
    target.remove();
  });
});
