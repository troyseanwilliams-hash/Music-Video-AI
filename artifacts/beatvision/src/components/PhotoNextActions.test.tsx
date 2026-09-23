import { isValidElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { PhotoNextActions } from "./PhotoNextActions";

function findByTestId(node: ReactNode, testId: string): Record<string, unknown> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findByTestId(child, testId);
      if (found) return found;
    }
  }
  if (!isValidElement(node)) return undefined;
  const props = node.props as Record<string, unknown>;
  if (props["data-testid"] === testId) return props;
  return findByTestId(props.children as ReactNode, testId);
}

describe("PhotoNextActions", () => {
  it("exposes both 44px mobile actions and runs their click handlers", () => {
    const onAnimate = vi.fn();
    const onTellStory = vi.fn();
    const tree = PhotoNextActions({ onAnimate, onTellStory });
    const animate = findByTestId(tree, "animate-photo-action")!;
    const story = findByTestId(tree, "story-photo-action")!;

    expect(animate.className).toContain("min-h-11");
    expect(story.className).toContain("min-h-11");
    (animate.onClick as () => void)();
    (story.onClick as () => void)();
    expect(onAnimate).toHaveBeenCalledOnce();
    expect(onTellStory).toHaveBeenCalledOnce();
  });
});