// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorTabList, EditorTabPanel, revealThen, useEditorTabReveal, type EditorTab } from "./editorTabs";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Harness() {
  const [active, setActive] = useState<EditorTab>("media");
  useEditorTabReveal(setActive);
  return (
    <div>
      <EditorTabList active={active} onChange={setActive} />
      <EditorTabPanel tab="media" active={active}><input data-testid="draft" /></EditorTabPanel>
      <EditorTabPanel tab="overlay" active={active}><div data-commentary-guide="overlays">overlays</div></EditorTabPanel>
      <EditorTabPanel tab="audio" active={active}><button data-montage-guide="audio">music</button></EditorTabPanel>
      <EditorTabPanel tab="export" active={active}><div data-montage-guide="export">export</div></EditorTabPanel>
    </div>
  );
}

let host: HTMLDivElement;
let root: Root;
const q = (sel: string) => host.querySelector<HTMLElement>(sel)!;
const tab = (id: string) => q(`[data-testid="tab-editor-${id}"]`);
const panel = (id: string) => q(`[data-testid="panel-editor-${id}"]`);

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(<Harness />));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe("Creator Studio editor tabs", () => {
  it("renders Media, Overlay, Audio, Export with ARIA wiring", () => {
    const tabs = Array.from(host.querySelectorAll('[role="tab"]')).map((t) => t.textContent);
    expect(tabs.map((t) => t?.match(/^(Media|Overlay|Audio|Export)/)?.[0])).toEqual(["Media", "Overlay", "Audio", "Export"]);
    expect(tab("media").getAttribute("aria-selected")).toBe("true");
    expect(tab("media").getAttribute("aria-controls")).toBe(panel("media").id);
    expect(panel("overlay").hidden).toBe(true);
  });

  it("selects a tab on click", () => {
    act(() => tab("audio").click());
    expect(tab("audio").getAttribute("aria-selected")).toBe("true");
    expect(panel("audio").hidden).toBe(false);
    expect(panel("media").hidden).toBe(true);
  });

  it("supports arrow, Home and End keys with roving tabindex", () => {
    const list = q('[role="tablist"]');
    const press = (key: string) => act(() => { list.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })); });
    press("ArrowRight");
    expect(tab("overlay").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tab("overlay"));
    expect(tab("overlay").tabIndex).toBe(0);
    expect(tab("media").tabIndex).toBe(-1);
    press("End");
    expect(tab("export").getAttribute("aria-selected")).toBe("true");
    press("ArrowRight");
    expect(tab("media").getAttribute("aria-selected")).toBe("true");
    press("ArrowLeft");
    expect(tab("export").getAttribute("aria-selected")).toBe("true");
    press("Home");
    expect(tab("media").getAttribute("aria-selected")).toBe("true");
  });

  it("keeps inactive panels mounted so drafts survive switching", () => {
    const input = q('[data-testid="draft"]') as HTMLInputElement;
    input.value = "unsaved edit";
    act(() => tab("export").click());
    expect(q('[data-testid="draft"]')).toBe(input);
    act(() => tab("media").click());
    expect((q('[data-testid="draft"]') as HTMLInputElement).value).toBe("unsaved edit");
  });

  it("activates the hidden tab before scrolling to a guide target", () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => { frames.push(cb); return frames.length; });
    const target = q('[data-commentary-guide="overlays"]');
    const scroll = vi.fn(() => {
      expect(panel("overlay").hidden).toBe(false);
    });
    act(() => { revealThen(target, scroll); });
    expect(scroll).not.toHaveBeenCalled();
    while (frames.length) frames.shift()!(0);
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(tab("overlay").getAttribute("aria-selected")).toBe("true");
  });

  it("scrolls immediately when the target is already visible", () => {
    const raf = vi.spyOn(window, "requestAnimationFrame");
    act(() => tab("audio").click());
    const scroll = vi.fn();
    revealThen(q('[data-montage-guide="audio"]'), scroll);
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(raf).not.toHaveBeenCalled();
  });
});
