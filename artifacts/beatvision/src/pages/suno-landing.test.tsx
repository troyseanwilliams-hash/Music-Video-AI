// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import SunoLanding from "./suno-landing";

const navigate = vi.fn();
vi.mock("wouter", () => ({
  useLocation: () => ["/suno", navigate],
  Link: ({ children, ...props }: React.PropsWithChildren<{ href: string }>) => <a {...props}>{children}</a>,
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAuthenticated: true }) }));
vi.mock("@/components/AuroraBackground", () => ({ AuroraBackground: () => null }));
vi.mock("framer-motion", () => ({
  motion: { div: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) =>
    <div className={props.className as string}>{children}</div> },
}));

const validUrl = "https://suno.com/song/12345678-1234-1234-1234-123456789abc";
let container: HTMLDivElement;
let root: Root;

function input(value: string) {
  const element = container.querySelector<HTMLInputElement>('[data-testid="input-suno-landing-url"]')!;
  // React tracks native setters to detect input changes.
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function click() {
  act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-suno-landing-go"]')!.click());
}

describe("Suno landing link entry", () => {
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    navigate.mockReset();
    localStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<SunoLanding />));
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("rejects an arbitrary host, then accepts the corrected HTTPS song link on click", () => {
    input(`https://evil.example/redirect?next=${encodeURIComponent(validUrl)}`);
    click();
    expect(container.querySelector(".text-destructive")?.textContent).toContain("valid HTTPS Suno");
    expect(navigate).not.toHaveBeenCalled();
    expect(localStorage.getItem("pendingSunoUrl")).toBeNull();
    input(validUrl);
    expect(container.querySelector(".text-destructive")).toBeNull();
    click();
    expect(localStorage.getItem("pendingSunoUrl")).toBe(validUrl);
    expect(navigate).toHaveBeenCalledWith(`/generate?suno=${encodeURIComponent(validUrl)}`);
  });

  it("accepts an allowlisted short share link, not a lookalike", () => {
    input("https://suno.com.evil.example/s/abc");
    click();
    expect(navigate).not.toHaveBeenCalled();
    input("https://suno.com/s/abc_123");
    click();
    expect(navigate).toHaveBeenCalledWith("/generate?suno=https%3A%2F%2Fsuno.com%2Fs%2Fabc_123");
  });
});