// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Pricing from "./pricing";

const navigate = vi.fn();
const checkout = vi.fn();
const toast = vi.fn();
let authenticated = true;
const plans = {
  subscriptions: [
    { id: "starter", name: "Starter", description: "Starter", kind: "subscription", popular: false,
      prices: [
        { id: "price_test_starter_month", lookupKey: "starter_monthly", interval: "month", unitAmount: 2000, currency: "usd", credits: 1000 },
        { id: "price_test_starter_year", lookupKey: "starter_yearly", interval: "year", unitAmount: 20000, currency: "usd", credits: 12000 },
      ] },
    { id: "pro", name: "Pro", description: "Pro", kind: "subscription", popular: true,
      prices: [
        { id: "price_test_pro_month", lookupKey: "pro_monthly", interval: "month", unitAmount: 4500, currency: "usd", credits: 2500 },
        { id: "price_test_pro_year", lookupKey: "pro_yearly", interval: "year", unitAmount: 45000, currency: "usd", credits: 30000 },
      ] },
    { id: "studio", name: "Studio", description: "Studio", kind: "subscription", popular: false,
      prices: [
        { id: "price_test_studio_month", lookupKey: "studio_monthly", interval: "month", unitAmount: 7900, currency: "usd", credits: 5000 },
        { id: "price_test_studio_year", lookupKey: "studio_yearly", interval: "year", unitAmount: 79000, currency: "usd", credits: 60000 },
      ] },
  ],
  topups: [],
};

vi.mock("wouter", () => ({
  useLocation: () => ["/pricing", navigate],
  Link: ({ href, children }: React.PropsWithChildren<{ href: string }>) => <a href={href}>{children}</a>,
}));
vi.mock("@/hooks/useAuth", () => ({
  AUTH_QUERY_KEY: ["auth"],
  useAuth: () => ({ isAuthenticated: authenticated, isLoading: false }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ getQueryData: () => null, invalidateQueries: vi.fn() }),
}));
vi.mock("@/hooks/useSEO", () => ({ useSEO: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn(), trackEvent: vi.fn() }));
vi.mock("@workspace/api-client-react", () => ({
  useListBillingPlans: () => ({ data: plans, isLoading: false }),
  useGetBillingSubscription: () => ({ data: null }),
  createBillingCheckout: (args: unknown) => checkout(args),
  createBillingPortalSession: vi.fn(),
  getGetBillingSubscriptionQueryKey: () => ["subscription"],
  getGetCreditsQueryKey: () => ["credits"],
  getGetDashboardStatsQueryKey: () => ["stats"],
}));

describe("pricing interval selection", () => {
  let root: Root;
  let container: HTMLDivElement;
  const button = (testId: string) => container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)!;
  const click = (testId: string) => act(() => button(testId).click());
  const render = () => act(() => root.render(<Pricing />));

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    checkout.mockReset();
    // Do not open a real checkout or let an async redirect resolve in tests.
    checkout.mockImplementation(() => new Promise(() => {}));
    navigate.mockReset();
    authenticated = true;
    window.history.replaceState({}, "", "/pricing");
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    render();
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("uses the selected yearly catalog price for checkout, never a monthly price", () => {
    click("button-interval-yearly");
    expect(button("button-interval-yearly").getAttribute("aria-pressed")).toBe("true");
    expect(window.location.search).toBe("?interval=year");
    const pro = container.querySelector('[data-testid="card-plan-pro"]')!;
    expect(pro.textContent).toContain("$450");
    expect(pro.textContent).toContain("$37.50/month effective");
    expect(pro.textContent).toContain("30,000 credits per year");
    expect(pro.textContent).toContain("Save $90");
    click("button-subscribe-pro");
    expect(checkout).toHaveBeenCalledExactlyOnceWith({ priceId: "price_test_pro_year" });
  });

  it("restores interval on refresh and browser back, then selects matching monthly price", () => {
    click("button-interval-yearly");
    act(() => { root.unmount(); root = createRoot(container); });
    render();
    expect(button("button-interval-yearly").getAttribute("aria-pressed")).toBe("true");
    act(() => {
      window.history.replaceState({}, "", "/pricing?interval=month");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(button("button-interval-monthly").getAttribute("aria-pressed")).toBe("true");
    click("button-subscribe-pro");
    expect(checkout).toHaveBeenCalledExactlyOnceWith({ priceId: "price_test_pro_month" });
  });

  it("carries the selected interval and plan to registration without checkout", () => {
    authenticated = false;
    render();
    click("button-interval-yearly");
    click("button-subscribe-studio");
    expect(checkout).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(expect.stringContaining("interval=year"));
    expect(navigate).toHaveBeenCalledWith(expect.stringContaining("plan=studio"));
  });
});