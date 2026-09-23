import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => {
  const slots: Array<{ value?: unknown; deps?: unknown[] }> = [];
  let cursor = 0;
  const sameDeps = (a?: unknown[], b?: unknown[]) =>
    !!a && !!b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  return {
    reset: () => { cursor = 0; },
    clear: () => { slots.length = 0; cursor = 0; },
    useState(initial: unknown) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: typeof initial === "function" ? (initial as () => unknown)() : initial };
      return [
        slots[index].value,
        (next: unknown) => {
          slots[index].value = typeof next === "function"
            ? (next as (current: unknown) => unknown)(slots[index].value)
            : next;
        },
      ];
    },
    useRef(initial: unknown) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: { current: initial } };
      return slots[index].value;
    },
    useMemo(factory: () => unknown, deps: unknown[]) {
      const index = cursor++;
      if (!slots[index] || !sameDeps(slots[index].deps, deps)) {
        slots[index] = { value: factory(), deps };
      }
      return slots[index].value;
    },
    useEffect(effect: () => unknown, deps: unknown[]) {
      const index = cursor++;
      if (!slots[index] || !sameDeps(slots[index].deps, deps)) {
        slots[index] = { deps };
        effect();
      }
    },
  };
});

vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: hooks.useState,
  useRef: hooks.useRef,
  useMemo: hooks.useMemo,
  useEffect: hooks.useEffect,
}));

import { PhotoAnimationDialog } from "./PhotoAnimationDialog";

function textContent(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join(" ");
  if (!isValidElement(node)) return "";
  return textContent((node.props as { children?: ReactNode }).children);
}

describe("PhotoAnimationDialog ready state", () => {
  const source = { kind: "asset" as const, imageAssetId: "image-1" };
  const key = "photo-animation:pending:user-1:asset:image-1";
  let entries: Map<string, string>;

  beforeEach(() => {
    hooks.clear();
    entries = new Map([[key, JSON.stringify({
      jobId: "job-1",
      sourceKey: "asset:image-1",
      createdAt: 1,
    })]]);
    vi.stubGlobal("localStorage", {
      getItem: (storageKey: string) => entries.get(storageKey) ?? null,
      setItem: (storageKey: string, value: string) => entries.set(storageKey, value),
      removeItem: (storageKey: string) => entries.delete(storageKey),
      key: () => null,
      length: 0,
    });
    vi.stubGlobal("window", {
      dispatchEvent: vi.fn(),
      setInterval: vi.fn(() => 1),
      clearInterval: vi.fn(),
    });
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ id: "job-1", status: "ready" }),
    })));
  });

  it("keeps the ready view when a parent recreates an equivalent source object", async () => {
    const props = {
      open: true,
      onOpenChange: vi.fn(),
      source,
      imageUrl: "/image.png",
      userId: "user-1",
    };
    const render = (nextSource: typeof source) => {
      hooks.reset();
      return PhotoAnimationDialog({ ...props, source: nextSource });
    };

    render(source); // restore pending job
    render({ ...source }); // begin poll
    await Promise.resolve();
    await Promise.resolve();
    render({ ...source }); // observe ready and cleared pending storage
    const stableReadyTree = render({ ...source }); // parent creates source again

    expect(entries.has(key)).toBe(false);
    expect(textContent(stableReadyTree)).toContain("Your clip is ready");
    expect(textContent(stableReadyTree)).not.toContain("Review prompt & cost");
  });
});