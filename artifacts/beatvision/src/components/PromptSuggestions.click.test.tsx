import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PromptSuggestions } from "./PromptSuggestions";

const state = vi.hoisted(() => ({
  numbered: false,
  setApplied: vi.fn(),
}));

// Exercise the rendered control's handler without a browser or paid API.
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useMemo: (compute: () => unknown) => compute(),
  useEffect: () => undefined,
  useState: (initial: unknown) => [
    initial === "summary" && state.numbered ? "numbered" : initial,
    initial === false ? state.setApplied : vi.fn(),
  ],
}));

function findButton(node: ReactNode): Record<string, unknown> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findButton(child);
      if (found) return found;
    }
  }
  if (!isValidElement(node)) return undefined;
  const props = node.props as Record<string, unknown>;
  if (props["data-testid"] === "button-use-prompt-example") return props;
  return findButton(props.children as ReactNode);
}

describe("Use example action", () => {
  beforeEach(() => {
    state.numbered = false;
    state.setApplied.mockClear();
  });

  it.each(["image", "narrative"] as const)("applies the %s summary only on click", (mode) => {
    const onUseExample = vi.fn();
    const button = findButton(PromptSuggestions({ mode, imageCount: 4, onUseExample }))!;
    expect(onUseExample).not.toHaveBeenCalled();
    expect(button.disabled).toBe(false);
    (button.onClick as () => void)();
    expect(onUseExample).toHaveBeenCalledWith(expect.any(String), undefined);
    expect(onUseExample.mock.calls[0][0].length).toBeGreaterThan(20);
    expect(state.setApplied).toHaveBeenCalledWith(true);
  });

  it("applies numbered image scenes with their matching image count", () => {
    state.numbered = true;
    const onUseExample = vi.fn();
    const button = findButton(PromptSuggestions({ mode: "image", imageCount: 7, onUseExample }))!;
    expect(button.disabled).toBe(false);
    (button.onClick as () => void)();
    const [prompt, count] = onUseExample.mock.calls[0];
    expect(prompt).toMatch(/^1\./);
    expect(count).toBe(prompt.split("\n").length);
    expect(state.setApplied).toHaveBeenCalledWith(true);
  });
});