// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useSunoImportRequest } from "./useSunoImportRequest";

const songA = "https://suno.com/song/12345678-1234-1234-1234-123456789abc";
const songB = "https://suno.com/song/abcdefab-1234-1234-1234-123456789abc";

function Harness() {
  const request = useSunoImportRequest();
  const [url, setUrl] = useState("");
  const [track, setTrack] = useState("Previous song");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return <>
    <input aria-label="Suno link" value={url} onChange={(e) => {
      request.cancel();
      setBusy(false);
      setError("");
      setUrl(e.target.value);
    }} />
    <button onClick={() => {
      if (request.isActive()) return;
      setBusy(true);
      void request.start(url, {
        success: (data) => setTrack(data.title),
        error: setError,
        settled: () => setBusy(false),
      });
    }}>Import</button>
    <button onClick={() => { request.cancel(); setBusy(false); }}>Cancel</button>
    <span data-testid="track">{track}</span>
    <span data-testid="busy">{String(busy)}</span>
    <span role="alert">{error}</span>
  </>;
}

let container: HTMLDivElement;
let root: Root;
function field(value: string) {
  const element = container.querySelector("input")!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function click(label: string) {
  act(() => Array.from(container.querySelectorAll("button")).find((button) => button.textContent === label)!.click());
}
async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}
const text = (testId: string) => container.querySelector(`[data-testid="${testId}"]`)?.textContent;

describe("Suno import click flow", () => {
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => root.render(<Harness />));
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("retains prior music on error, then succeeds on an explicit retry", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Private song" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ objectPath: "/objects/new", url: "/audio/new", title: "New song" }) });
    vi.stubGlobal("fetch", fetcher);
    field(songA);
    expect(fetcher).not.toHaveBeenCalled(); // editing/blur does not import
    click("Import");
    await flush();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Private song");
    expect(text("track")).toBe("Previous song");
    click("Import");
    await flush();
    expect(text("track")).toBe("New song");
    expect(text("busy")).toBe("false");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("ignores a late response after edit, cancellation and a newer successful source", async () => {
    let resolveOld!: (value: unknown) => void;
    const fetcher = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ objectPath: "/objects/new", url: "/audio/new", title: "Latest song" }) });
    vi.stubGlobal("fetch", fetcher);
    field(songA);
    click("Import");
    click("Import");
    expect(fetcher).toHaveBeenCalledTimes(1); // atomic guard
    click("Cancel");
    field(songB);
    click("Import");
    await flush();
    expect(text("track")).toBe("Latest song");
    await act(async () => {
      resolveOld({ ok: true, json: async () => ({ objectPath: "/objects/old", url: "/audio/old", title: "Stale song" }) });
      await Promise.resolve();
    });
    expect(text("track")).toBe("Latest song");
    expect(text("busy")).toBe("false");
  });
});