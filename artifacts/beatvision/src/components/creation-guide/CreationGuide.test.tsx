// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreationGuide } from "./CreationGuide";
import { FIRST_CREATION_CHOICES } from "@/lib/firstCreationChoices";
import { getStarterCost } from "@/lib/starterVideo";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(), track: vi.fn(),
  auth: { user: { id: "test-first-creation" }, isAuthenticated: true },
}));
vi.mock("wouter", () => ({ useLocation: () => ["/", mocks.navigate] }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/lib/analytics", () => ({ track: mocks.track }));

describe("First creation choices", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.auth.isAuthenticated = true;
    mocks.navigate.mockClear();
    mocks.track.mockClear();
    localStorage.clear();
    localStorage.setItem("bv-guide-dismissed-v1-test-first-creation", "true");
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); });
  function open() {
    act(() => root.render(<CreationGuide />));
    act(() => document.querySelector<HTMLButtonElement>('[data-testid="button-help-create"]')!.click());
  }
  it("shows three primary starts and keeps all other tools collapsed", () => {
    open();
    const list = document.querySelector('[data-testid="creation-goal-list"]')!;
    expect(list.querySelectorAll(":scope > button")).toHaveLength(3);
    const extra = list.querySelector("details")!;
    expect(extra.open).toBe(false);
    expect(extra.querySelectorAll("button")).toHaveLength(4);
    expect(list.textContent).toContain(`${getStarterCost().total} credits`);
    expect(list.textContent).toContain("Approve the storyboard before spending");
  });
  it.each(FIRST_CREATION_CHOICES)("routes $goal without submitting a creation", choice => {
    open();
    act(() => document.querySelector<HTMLButtonElement>(`[data-testid="goal-${choice.goal}"]`)!.click());
    expect(mocks.navigate).toHaveBeenCalledWith(choice.href);
    expect(mocks.track).toHaveBeenCalledWith("goal_selected", { goal: choice.goal, source: "welcome" });
  });
  it("preserves the selected destination through anonymous registration", () => {
    mocks.auth.isAuthenticated = false;
    open();
    act(() => document.querySelector<HTMLButtonElement>('[data-testid="goal-generate"]')!.click());
    const destination = new URL(mocks.navigate.mock.calls[0][0], "https://example.test");
    expect(destination.pathname).toBe("/register");
    expect(destination.searchParams.get("returnTo")).toBe("/generate?guide=starter");
  });
});
