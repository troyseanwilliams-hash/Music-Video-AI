// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EmailConfirmation } from "./EmailConfirmation";
const api = vi.hoisted(() => vi.fn());
vi.mock("@workspace/api-client-react", () => ({ confirmAccountEmail: api }));
let root: Root;
let host: HTMLDivElement;
let client: QueryClient;
const back = vi.fn();
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  api.mockReset(); back.mockReset();
  host = document.createElement("div"); document.body.append(host);
  root = createRoot(host); client = new QueryClient();
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });
async function render(emailSent?: boolean) {
  await act(async () => root.render(<QueryClientProvider client={client}><EmailConfirmation email="fixture@example.invalid" emailSent={emailSent} onBack={back} /></QueryClientProvider>));
}
async function submit() {
  await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  await act(settle);
}
it("explains delivery failure and requires password/code instead of claiming success", async () => {
  await render(false);
  expect(host.textContent).toContain("couldn’t send");
  expect(host.querySelector('input[type="password"]')).toBeTruthy();
  expect(host.querySelector('input[autocomplete="one-time-code"]')?.getAttribute("maxlength")).toBe("8");
  const resend = Array.from(host.querySelectorAll("button")).find(b => b.textContent?.includes("Resend"))!;
  expect(resend.disabled).toBe(true);
});
it("keeps incorrect-code errors visible and returns to sign-in only after confirmation", async () => {
  await render();
  api.mockRejectedValueOnce(new Error("Code expired."));
  await submit();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Code expired");
  expect(back).not.toHaveBeenCalled();
  api.mockResolvedValueOnce({ verified: true });
  await submit();
  expect(host.textContent).toContain("Email confirmed");
  expect(host.querySelector("form")).toBeNull();
  await act(async () => host.querySelector("button")!.click());
  expect(back).toHaveBeenCalledOnce();
});
