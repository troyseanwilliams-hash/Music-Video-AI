// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { StarterRightsGate, resolveAcceptCopyright } from "./StarterRightsGate";
import type { StarterAudioChoice } from "@/lib/starterVideo";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null; });

/** Mirrors Generate: one shared acknowledgment state, reset whenever the track changes, mapped into the request. */
function Harness({ onSubmit }: { onSubmit: (acceptCopyright: boolean) => void }) {
  const [audio, setAudio] = useState<StarterAudioChoice>("upload");
  const [track, setTrack] = useState("/objects/a");
  const [ack, setAck] = useState(false);
  const choose = (a: StarterAudioChoice, t: string) => { setAudio(a); setTrack(t); setAck(false); };
  return (
    <div>
      <button data-testid="pick-upload" onClick={() => choose("upload", "/objects/up")} />
      <button data-testid="pick-library" onClick={() => choose("library", "/objects/lib")} />
      <button data-testid="pick-silent" onClick={() => choose("silent", "")} />
      <span data-testid="track">{track}</span>
      <StarterRightsGate
        audio={audio}
        rightsAccepted={ack}
        onRightsChange={setAck}
        otherwiseReady
        onProceed={() => onSubmit(resolveAcceptCopyright(audio !== "silent", ack))}
      >
        Preview storyboard
      </StarterRightsGate>
    </div>
  );
}

function mount(onSubmit: (v: boolean) => void) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<Harness onSubmit={onSubmit} />));
  const q = (id: string) => host!.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  const click = (id: string) => act(() => { q(id)!.click(); });
  return { q, click };
}

describe("starter rights attestation", () => {
  for (const source of ["upload", "library"] as const) {
    it(`${source}: unchecked by default, blocks proceed, submits acceptCopyright true only after attesting`, () => {
      const onSubmit = vi.fn();
      const { q, click } = mount(onSubmit);
      click(`pick-${source}`);
      const box = q("checkbox-starter-rights") as HTMLInputElement;
      expect(box).not.toBeNull();
      expect(box.checked).toBe(false);
      expect((q("button-starter-storyboard") as HTMLButtonElement).disabled).toBe(true);
      click("checkbox-starter-rights");
      expect((q("checkbox-starter-rights") as HTMLInputElement).checked).toBe(true);
      click("button-starter-storyboard");
      expect(onSubmit).toHaveBeenCalledWith(true);
    });
  }

  it("resets the attestation when the track changes", () => {
    const { q, click } = mount(vi.fn());
    click("pick-upload");
    click("checkbox-starter-rights");
    click("pick-library");
    expect((q("checkbox-starter-rights") as HTMLInputElement).checked).toBe(false);
    expect((q("button-starter-storyboard") as HTMLButtonElement).disabled).toBe(true);
  });

  it("silence is exempt and needs no attestation", () => {
    const onSubmit = vi.fn();
    const { q, click } = mount(onSubmit);
    click("pick-silent");
    expect(q("checkbox-starter-rights")).toBeNull();
    click("button-starter-storyboard");
    expect(onSubmit).toHaveBeenCalledWith(true);
  });

  it("request mapping never defaults audio rights to true", () => {
    expect(resolveAcceptCopyright(true, false)).toBe(false);
    expect(resolveAcceptCopyright(true, true)).toBe(true);
    expect(resolveAcceptCopyright(false, false)).toBe(true);
  });
});
