// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import GenerateCreditPurchase from "./GenerateCreditPurchase";
import { GENERATE_CREDIT_RETURN_KEY, notifyGenerateCreditReturn } from "@/lib/generateCreditCheckout";

const checkout = vi.fn();
const stats = vi.fn();
const refetch = vi.fn();
let catalogLoading = false;
let catalogError = false;
const catalog = { topups: [{ id: "pack", name: "Credit pack", prices: [
  { id: "price_catalog_pack", credits: 1000, unitAmount: 2500, currency: "usd" },
] }] };
vi.mock("@workspace/api-client-react", () => ({
  createBillingCheckout: (args: unknown) => checkout(args),
  getDashboardStats: () => stats(),
  getGetDashboardStatsQueryKey: () => ["stats"],
  getGetBillingSubscriptionQueryKey: () => ["subscription"],
  getGetCreditsQueryKey: () => ["credits"],
  getListBillingPlansQueryKey: () => ["plans"],
  useListBillingPlans: () => ({ data: catalog, isLoading: catalogLoading, isError: catalogError, refetch }),
}));
vi.mock("@/hooks/useAuth", () => ({ AUTH_QUERY_KEY: ["auth"] }));

// Representative parent-owned draft state: purchases must not navigate, remount,
// mutate these values, or auto-submit a reviewed script.
let mounts = 0;
function Draft() {
  const [open, setOpen] = useState(true);
  const [audio] = useState(() => { mounts++; return "/objects/uploaded-track.wav"; });
  const [script] = useState("Reviewed scene script");
  const [approved] = useState(true);
  const [resolution] = useState("1080p");
  return <>
    <input data-testid="draft-audio" value={audio} readOnly />
    <textarea data-testid="draft-script" value={script} readOnly />
    <input data-testid="draft-approved" type="checkbox" checked={approved} readOnly />
    <input data-testid="draft-resolution" value={resolution} readOnly />
    <GenerateCreditPurchase open={open} onOpenChange={setOpen} creditsRequired={450} creditsRemaining={10} />
  </>;
}

describe("Generate credit purchase", () => {
  let root: Root;
  let container: HTMLDivElement;
  let client: QueryClient;
  const button = (id: string) => document.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)!;
  const click = async (id: string) => { await act(async () => { button(id).click(); }); };
  const returnFocus = async () => { await act(async () => { window.dispatchEvent(new Event("focus")); }); };
  const rerender = () => act(() => root.render(<QueryClientProvider client={client}><Draft /></QueryClientProvider>));
  const tab = () => ({ opener: {}, closed: false, location: { href: "" }, close: vi.fn() });
  const assertDraft = () => {
    expect(mounts).toBe(1);
    expect(container.querySelector<HTMLInputElement>('[data-testid="draft-audio"]')!.value).toBe("/objects/uploaded-track.wav");
    expect(container.querySelector<HTMLTextAreaElement>('[data-testid="draft-script"]')!.value).toBe("Reviewed scene script");
    expect(container.querySelector<HTMLInputElement>('[data-testid="draft-approved"]')!.checked).toBe(true);
    expect(container.querySelector<HTMLInputElement>('[data-testid="draft-resolution"]')!.value).toBe("1080p");
    expect(window.location.pathname).toBe("/generate");
  };
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    mounts = 0;
    catalogLoading = false;
    catalogError = false;
    checkout.mockReset().mockResolvedValue({ url: "https://checkout.stripe.com/test-session" });
    stats.mockReset().mockResolvedValue({ creditsRemaining: 10 });
    refetch.mockReset();
    vi.spyOn(window, "open").mockReturnValue(tab() as unknown as Window);
    window.history.replaceState({}, "", "/generate");
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    rerender();
  });
  afterEach(() => {
    act(() => root.unmount());
    client.clear();
    container.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("uses the real catalog price and opens the tab synchronously without navigating or clobbering the draft", async () => {
    let resolve!: (value: { url: string }) => void;
    checkout.mockReturnValue(new Promise(r => { resolve = r; }));
    await click("button-generate-topup-price_catalog_pack");
    expect(window.open).toHaveBeenCalledWith("about:blank", "_blank");
    expect(button("button-generate-topup-price_catalog_pack").disabled).toBe(true);
    expect(checkout).toHaveBeenCalledWith({
      priceId: "price_catalog_pack",
      successUrl: expect.stringMatching(/^\/pricing\?status=success&creditReturn=/),
      cancelUrl: expect.stringMatching(/^\/pricing\?status=cancelled&creditReturn=/),
    });
    await act(async () => { resolve({ url: "https://checkout.stripe.com/test-session" }); });
    const opened = vi.mocked(window.open).mock.results[0].value!;
    expect(opened.opener).toBeNull();
    expect(opened.location.href).toBe("https://checkout.stripe.com/test-session");
    expect(document.body.textContent).toContain("$25.00");
    assertDraft();
  });

  it("provides a safe new-tab fallback when popups are blocked", async () => {
    vi.mocked(window.open).mockReturnValue(null);
    await click("button-generate-topup-price_catalog_pack");
    expect(document.body.textContent).toContain("browser blocked");
    const link = document.querySelector<HTMLAnchorElement>('[data-testid="link-generate-secure-checkout"]')!;
    expect(link.href).toBe("https://checkout.stripe.com/test-session");
    expect(link.target).toBe("_blank");
    expect(link.rel).toContain("noopener");
    assertDraft();
  });

  it("retains the fallback link if the user closes the blank tab while checkout loads", async () => {
    const opened = tab();
    vi.mocked(window.open).mockReturnValue(opened as unknown as Window);
    let resolve!: (value: { url: string }) => void;
    checkout.mockReturnValue(new Promise(r => { resolve = r; }));
    await click("button-generate-topup-price_catalog_pack");
    opened.closed = true;
    await act(async () => { resolve({ url: "https://checkout.stripe.com/test-session" }); });
    expect(document.querySelector('[data-testid="link-generate-secure-checkout"]')).not.toBeNull();
    expect(opened.location.href).toBe("");
    assertDraft();
  });

  it("closes the blank tab on checkout error and permits retry", async () => {
    const opened = tab();
    vi.mocked(window.open).mockReturnValue(opened as unknown as Window);
    checkout.mockRejectedValueOnce(new Error("Checkout unavailable"));
    await click("button-generate-topup-price_catalog_pack");
    expect(opened.close).toHaveBeenCalled();
    expect(document.body.textContent).toContain("Checkout unavailable");
    expect(button("button-generate-topup-price_catalog_pack").disabled).toBe(false);
    await click("button-generate-topup-price_catalog_pack");
    expect(checkout).toHaveBeenCalledTimes(2);
    assertDraft();
  });

  it("refreshes on return, waits for a delayed webhook, updates credit cache, and preserves approved setup", async () => {
    await click("button-generate-topup-price_catalog_pack");
    await returnFocus();
    expect(stats).toHaveBeenCalledTimes(1);
    expect(client.getQueryData(["stats"])).toEqual({ creditsRemaining: 10 });
    stats.mockResolvedValue({ creditsRemaining: 1010 });
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(client.getQueryData(["stats"])).toEqual({ creditsRemaining: 1010 });
    expect(document.body.textContent).toContain("1,010 credits");
    const calls = stats.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(stats).toHaveBeenCalledTimes(calls);
    assertDraft();
  });

  it("surfaces refresh errors and supports manual retry", async () => {
    stats.mockRejectedValueOnce(new Error("Credit service unavailable"));
    await click("button-refresh-generate-credits");
    expect(document.body.textContent).toContain("Credit service unavailable");
    expect(button("button-refresh-generate-credits").disabled).toBe(false);
    await click("button-refresh-generate-credits");
    expect(document.body.textContent).toContain("Balance refreshed");
    assertDraft();
  });

  it("keeps checking when the dialog is dismissed, bounds polling, and allows another manual check", async () => {
    await click("button-generate-topup-price_catalog_pack");
    await click("button-keep-editing-generate");
    await returnFocus();
    await act(async () => { await vi.advanceTimersByTimeAsync(62000); });
    expect(document.body.textContent).toContain("Still waiting");
    const calls = stats.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(stats).toHaveBeenCalledTimes(calls);
    await click("button-review-credit-purchase");
    stats.mockResolvedValue({ creditsRemaining: 1010 });
    await click("button-refresh-generate-credits");
    expect(document.body.textContent).toContain("1,010 credits");
    assertDraft();
  });

  it("recognizes matching cancellation but ignores other-tab purchase tokens", async () => {
    await click("button-generate-topup-price_catalog_pack");
    const token = new URL(checkout.mock.calls[0][0].cancelUrl, window.location.origin).searchParams.get("creditReturn");
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key: GENERATE_CREDIT_RETURN_KEY, newValue: JSON.stringify({ token: "other", status: "cancelled" }) }));
    });
    expect(stats).not.toHaveBeenCalled();
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key: GENERATE_CREDIT_RETURN_KEY, newValue: JSON.stringify({ token, status: "cancelled" }) }));
    });
    expect(document.body.textContent).toContain("Checkout cancelled");
    expect(document.querySelector('[data-testid="link-generate-secure-checkout"]')).toBeNull();
    assertDraft();
  });

  it("does not credit a success return until the API confirms a changed balance", async () => {
    await click("button-generate-topup-price_catalog_pack");
    const token = new URL(checkout.mock.calls[0][0].successUrl, window.location.origin).searchParams.get("creditReturn");
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key: GENERATE_CREDIT_RETURN_KEY, newValue: JSON.stringify({ token, status: "success" }) }));
    });
    expect(client.getQueryData(["stats"])).toEqual({ creditsRemaining: 10 });
    expect(document.querySelector('[data-testid="link-generate-secure-checkout"]')).not.toBeNull();
    expect(document.body.textContent).toContain("credits may take a moment");
    assertDraft();
  });

  it("refreshes on visible return and cleans up polling when unmounted", async () => {
    await click("button-generate-topup-price_catalog_pack");
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(stats).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
    const calls = stats.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(stats).toHaveBeenCalledTimes(calls);
    // Recreate an empty root for shared teardown.
    root = createRoot(container);
  });

  it("shows catalog loading and errors with a retry control", async () => {
    catalogLoading = true;
    rerender();
    expect(document.body.textContent).toContain("Loading credit packs");
    catalogLoading = false;
    catalogError = true;
    rerender();
    await click("button-retry-credit-packs");
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("publishes scoped return notifications without treating redirects as a credit grant", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const removeItem = vi.spyOn(Storage.prototype, "removeItem");
    notifyGenerateCreditReturn("?status=success&creditReturn=unique-token");
    expect(setItem).toHaveBeenCalledWith(GENERATE_CREDIT_RETURN_KEY, JSON.stringify({ token: "unique-token", status: "success" }));
    expect(removeItem).toHaveBeenCalledWith(GENERATE_CREDIT_RETURN_KEY);
    expect(stats).not.toHaveBeenCalled();
    setItem.mockClear();
    notifyGenerateCreditReturn("?status=success");
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockImplementation(() => { throw new Error("Storage blocked"); });
    expect(() => notifyGenerateCreditReturn("?status=cancelled&creditReturn=token")).not.toThrow();
  });
});