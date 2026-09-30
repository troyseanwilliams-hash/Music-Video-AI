// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { DashboardCreditBalance, DashboardCreditHistory } from "./DashboardCredits";

const { useHistory, refetch } = vi.hoisted(() => ({
  useHistory: vi.fn(),
  refetch: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({
  useListBillingGrants: useHistory,
  getListBillingGrantsQueryKey: () => ["/api/billing/grants"],
}));

let container: HTMLDivElement;
let root: Root;

function render(element: Parameters<Root["render"]>[0]) {
  act(() => root.render(element));
}

function text(testId: string) {
  return container.querySelector(`[data-testid="${testId}"]`)?.textContent;
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  useHistory.mockReturnValue({
    data: { grants: [] },
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch,
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe("dashboard credit balance", () => {
  it("shows separate real balances and the account's exact welcome expiration date", () => {
    const expiry = "2027-02-14T12:00:00.000Z";
    render(<DashboardCreditBalance stats={{ creditsRemaining: 435, welcomeCredits: 35, subscriptionCredits: 300, topupCredits: 100 }} welcomeExpiresAt={expiry} />);
    expect(text("text-credits-total")).toBe("435");
    expect(text("text-welcome-credits")).toBe("35");
    expect(text("text-subscription-credits")).toBe("300");
    expect(text("text-purchased-credits")).toBe("100");
    expect(container.querySelector("time")?.dateTime).toBe(expiry);
    expect(text("text-welcome-expiration")).toContain("2027");
  });

  it("shows zero buckets, and does not give legacy non-expiring credits a made-up expiry", () => {
    render(<DashboardCreditBalance stats={{ creditsRemaining: 110, welcomeCredits: 0, subscriptionCredits: 0, topupCredits: 110 }} welcomeExpiresAt={null} />);
    expect(text("text-welcome-credits")).toBe("0");
    expect(text("text-subscription-credits")).toBe("0");
    expect(text("text-purchased-credits")).toBe("110");
    expect(text("text-welcome-expiration")).toBe("No expiring welcome credits.");
    expect(container.querySelector("time")).toBeNull();
  });

  it("reports unavailable expiry rather than fabricating one", () => {
    render(<DashboardCreditBalance stats={{ creditsRemaining: 25, welcomeCredits: 25, subscriptionCredits: 0, topupCredits: 0 }} welcomeExpiresAt={null} />);
    expect(text("text-welcome-expiration")).toBe("Welcome credit expiration date unavailable.");
  });

  it("uses past tense for expired grants without altering paid balances", () => {
    render(<DashboardCreditBalance stats={{ creditsRemaining: 300, welcomeCredits: 0, subscriptionCredits: 200, topupCredits: 100 }} welcomeExpiresAt="2020-01-08T00:00:00Z" />);
    expect(text("text-welcome-expiration")).toContain("Welcome credits expired");
    expect(text("text-welcome-expiration")).toContain("not included in your balance");
    expect(text("text-purchased-credits")).toBe("100");
  });
});

describe("dashboard credit history", () => {
  it("reuses the real generated API, isolates accounts, and refreshes after navigation and during a session", () => {
    render(<DashboardCreditHistory userId="account-a" />);
    expect(useHistory).toHaveBeenLastCalledWith({
      query: {
        queryKey: ["/api/billing/grants", "account-a"],
        enabled: true,
        staleTime: 30_000,
        refetchInterval: 60_000,
        refetchOnMount: "always",
      },
    });
    render(<DashboardCreditHistory userId="account-b" />);
    expect(useHistory.mock.calls.at(-1)?.[0].query.queryKey).toEqual(["/api/billing/grants", "account-b"]);
  });

  it("renders server amounts, dates and all grant sources without treating grants as remaining balance", () => {
    useHistory.mockReturnValue({
      data: { grants: [
        { id: "sub", source: "subscription", creditsGranted: 500, createdAt: "2027-02-04T12:00:00Z", receiptUrl: "https://invoice.stripe.com/test" },
        { id: "buy", source: "topup", creditsGranted: 240, createdAt: "2027-02-03T12:00:00Z", receiptUrl: null },
        { id: "welcome", source: "trial", creditsGranted: 110, createdAt: "2027-02-02T12:00:00Z" },
        { id: "admin", source: "admin", creditsGranted: 15, createdAt: "2027-02-01T12:00:00Z" },
      ] },
    });
    render(<DashboardCreditHistory userId="account-a" />);
    expect(text("text-grant-amount-sub")).toBe("+500");
    expect(text("text-grant-amount-buy")).toBe("+240");
    expect(text("text-grant-amount-welcome")).toBe("+110");
    expect(text("text-grant-amount-admin")).toBe("+15");
    expect(container.textContent).toContain("Welcome grant");
    expect(container.textContent).toContain("Subscription credits");
    expect(container.textContent).toContain("Purchased credits");
    expect(container.textContent).toContain("Admin credit grant");
    expect(container.textContent).toContain("not a spending ledger");
    expect(container.querySelector("tbody time")?.getAttribute("datetime")).toBe("2027-02-04T12:00:00Z");
    const receipt = container.querySelector('[data-testid="link-credit-receipt-sub"]') as HTMLAnchorElement;
    expect(receipt.href).toBe("https://invoice.stripe.com/test");
    expect(receipt.target).toBe("_blank");
    expect(receipt.rel).toContain("noopener");
    expect(container.querySelector('[data-testid="link-credit-receipt-buy"]')).toBeNull();
    expect(text("row-credit-grant-buy")).toContain("Not available");
  });

  it("distinguishes loading, empty and error states and retries failures", () => {
    useHistory.mockReturnValue({ isLoading: true });
    render(<DashboardCreditHistory userId="account-a" />);
    expect(text("status-credit-history-loading")).toContain("Loading");
    expect(text("status-credit-history-empty")).toBeUndefined();
    useHistory.mockReturnValue({ data: { grants: [] }, isLoading: false });
    render(<DashboardCreditHistory userId="account-a" />);
    expect(text("status-credit-history-empty")).toBe("No credit grants recorded yet.");
    useHistory.mockReturnValue({ isError: true, refetch, isFetching: false });
    render(<DashboardCreditHistory userId="account-a" />);
    expect(text("status-credit-history-error")).toContain("Could not load credit history");
    act(() => (container.querySelector('[data-testid="button-retry-credit-history"]') as HTMLButtonElement).click());
    expect(refetch).toHaveBeenCalledOnce();
    expect(text("status-credit-history-empty")).toBeUndefined();
  });

  it("places history on the dashboard above daily content and retains the existing stats balance", () => {
    const dashboard = readFileSync("src/pages/dashboard.tsx", "utf8");
    expect(dashboard).toContain("<DashboardCreditBalance stats={stats}");
    expect(dashboard).toContain("welcomeExpiresAt={stats.welcomeExpiresAt ?? null}");
    expect(dashboard).toContain("<DashboardCreditHistory userId={user.id}");
    expect(dashboard.indexOf("<DashboardCreditHistory")).toBeLessThan(dashboard.indexOf("{/* Something of the Day"));
    expect(dashboard).not.toContain("top-up / welcome");
  });
});