// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Register from "./register";
import { FREE_OFFER_COPY } from "@/lib/freeOffer";

const navigate = vi.fn();
const register = vi.fn();
let path = "/register";

vi.mock("wouter", () => ({
  useLocation: () => [path, navigate],
  Link: ({ href, children }: React.PropsWithChildren<{ href: string }>) => <a href={href}>{children}</a>,
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ register }),
  isAuthTransportError: () => false,
}));
vi.mock("@/hooks/useSEO", () => ({ useSEO: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn(), trackEvent: vi.fn() }));

describe("registration offer and signup states", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    register.mockReset();
    navigate.mockReset();
    path = "/register";
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = () => act(() => root.render(<Register />));
  const fill = (id: string, value: string) => {
    const input = container.querySelector<HTMLInputElement>(`#${id}`)!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  const submit = async () => {
    await act(async () => {
      container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
  };

  it("shows accurate offer and only shows the referral bonus with a referral code", () => {
    render();
    expect(container.textContent).toContain(FREE_OFFER_COPY.short);
    expect(container.textContent).toContain(FREE_OFFER_COPY.afterTrial);
    expect(container.textContent).toContain(FREE_OFFER_COPY.credits);
    expect(container.textContent).not.toContain(FREE_OFFER_COPY.referral);
    path = "/register?ref=FRIEND";
    render();
    expect(container.textContent).toContain(FREE_OFFER_COPY.referral);
  });

  it("keeps error visible, loading accessible and navigates only after success", async () => {
    render();
    fill("name", "Test Person");
    fill("email", "test@example.com");
    fill("password", "password123");
    fill("confirmPassword", "password123");
    let rejectRequest!: (error: Error) => void;
    register.mockImplementationOnce(() => new Promise((_, reject) => { rejectRequest = reject; }));
    // Do not await the pending request inside act.
    act(() => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(container.querySelector("form")?.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
    await act(async () => rejectRequest(new Error("Email already registered")));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Email already registered");
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false);
    register.mockResolvedValueOnce(undefined);
    await submit();
    expect(navigate).toHaveBeenCalledWith("/generate");
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Account created");
  });
});