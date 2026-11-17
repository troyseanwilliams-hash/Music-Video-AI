// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TwoFactorSettings } from "./TwoFactorSettings";

const api = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn() }));
vi.mock("@workspace/api-client-react", () => ({ getTwoFactor: api.get, updateTwoFactor: api.update }));
let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

function button(text: string) {
  const element = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes(text));
  if (!element) throw new Error(`Missing button ${text}`);
  return element;
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  api.get.mockResolvedValue({ enabled: false, recoveryCodesRemaining: 0 });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); client.clear(); });

async function render() {
  await act(async () => root.render(<QueryClientProvider client={client}><TwoFactorSettings userId="fixture" /></QueryClientProvider>));
  await act(settle);
}
async function click(text: string) { await act(async () => button(text).click()); await act(settle); }
async function submit() {
  await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  await act(settle);
}

describe("two-factor settings controls", () => {
  it("requires confirmed setup before showing enabled and recovery codes", async () => {
    await render();
    expect(container.textContent).toContain("Not enabled");
    await click("Enable two-factor authentication");
    api.update.mockResolvedValueOnce({ enabled: false, secret: "FIXTUREKEY", qrCode: "data:image/png;base64,AA==", expiresAt: new Date().toISOString() });
    await submit();
    expect(container.textContent).toContain("FIXTUREKEY");
    expect(container.querySelector("img")?.alt).toContain("authenticator");
    expect(container.textContent).toContain("stays off until you confirm");
    api.get.mockResolvedValue({ enabled: true, recoveryCodesRemaining: 10 });
    api.update.mockResolvedValueOnce({ enabled: true, recoveryCodes: ["fixture-code"] });
    await submit();
    expect(container.textContent).not.toContain("FIXTUREKEY");
    expect(container.textContent).toContain("fixture-code");
    expect(button("Done").disabled).toBe(true);
    await act(async () => (container.querySelector('input[type="checkbox"]') as HTMLInputElement).click());
    expect(button("Done").disabled).toBe(false);
    await click("Done");
    expect(container.textContent).not.toContain("fixture-code");
    expect(container.textContent).toContain("Enabled");
    expect(button("Replace recovery codes")).toBeTruthy();
  });
  it("shows API failures without reporting success, and lets users cancel", async () => {
    await render();
    await click("Enable two-factor authentication");
    api.update.mockRejectedValueOnce(new Error("Incorrect password."));
    await submit();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Incorrect password");
    expect(container.textContent).toContain("Not enabled");
    await click("Cancel");
    expect(container.querySelector("form")).toBeNull();
    expect(button("Enable two-factor authentication")).toBeTruthy();
  });
  it("does not present an off state when loading status fails", async () => {
    api.get.mockRejectedValue(new Error("offline"));
    await render();
    expect(container.textContent).toContain("Couldn’t load");
    expect(container.textContent).not.toContain("Not enabled");
  });
});
