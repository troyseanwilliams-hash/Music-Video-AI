import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  createBillingCheckout,
  getDashboardStats,
  getGetDashboardStatsQueryKey,
  getGetBillingSubscriptionQueryKey,
  getGetCreditsQueryKey,
  getListBillingPlansQueryKey,
  useListBillingPlans,
} from "@workspace/api-client-react";
import { AUTH_QUERY_KEY } from "@/hooks/useAuth";
import { GENERATE_CREDIT_RETURN_KEY } from "@/lib/generateCreditCheckout";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { CreditCard, Loader2 } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  creditsRequired: number;
  creditsRemaining: number | null;
}

export default function GenerateCreditPurchase({ open, onOpenChange, creditsRequired, creditsRemaining }: Props) {
  const queryClient = useQueryClient();
  const plans = useListBillingPlans({
    query: { queryKey: getListBillingPlansQueryKey(), enabled: open },
  });
  const [busyPrice, setBusyPrice] = useState<string | null>(null);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const purchase = useRef<{ token: string; balance: number; cancelled: boolean } | null>(null);
  const mounted = useRef(true);
  const refreshInFlight = useRef(false);
  const checkoutInFlight = useRef(false);
  const polling = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopPolling = useCallback(() => {
    if (polling.current) clearInterval(polling.current);
    polling.current = null;
  }, []);

  const refresh = useCallback(async () => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    setRefreshing(true);
    setError("");
    try {
      // Refresh only credit caches, never the form, audio, or reviewed script.
      const stats = await queryClient.fetchQuery({
        queryKey: getGetDashboardStatsQueryKey(),
        queryFn: () => getDashboardStats(),
        staleTime: 0,
        retry: false,
      });
      if (!mounted.current) return;
      void queryClient.invalidateQueries({ queryKey: getGetBillingSubscriptionQueryKey() });
      void queryClient.invalidateQueries({ queryKey: getGetCreditsQueryKey() });
      void queryClient.invalidateQueries({ queryKey: AUTH_QUERY_KEY });
      const current = purchase.current;
      if (current && stats.creditsRemaining > current.balance) {
        purchase.current = null;
        stopPolling();
        setCheckoutUrl(null);
        setMessage(`Balance refreshed: ${stats.creditsRemaining.toLocaleString()} credits. Your setup is unchanged; continue when ready.`);
      } else if (current?.cancelled) {
        purchase.current = null;
        stopPolling();
        setCheckoutUrl(null);
        setMessage("Checkout cancelled. Your video setup is unchanged.");
      } else {
        setMessage(`Balance refreshed: ${stats.creditsRemaining.toLocaleString()} credits. If you paid, credits may take a moment to arrive. If you cancelled or closed checkout, you can keep editing.`);
      }
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : "Could not refresh credits. Please try again.");
    } finally {
      refreshInFlight.current = false;
      if (mounted.current) setRefreshing(false);
    }
  }, [queryClient, stopPolling]);

  const checkOnReturn = useCallback(() => {
    if (!purchase.current || document.visibilityState === "hidden") return;
    stopPolling();
    void refresh();
    const startedAt = Date.now();
    polling.current = setInterval(() => {
      if (!purchase.current || Date.now() - startedAt >= 60_000) {
        stopPolling();
        if (purchase.current) setMessage("Still waiting for updated credits. Refresh again if you completed payment. Your setup is unchanged.");
        return;
      }
      if (document.visibilityState !== "hidden") void refresh();
    }, 2000);
  }, [refresh, stopPolling]);

  useEffect(() => {
    mounted.current = true;
    const receive = (event: StorageEvent) => {
      if (event.key !== GENERATE_CREDIT_RETURN_KEY || !event.newValue || !purchase.current) return;
      try {
        const result = JSON.parse(event.newValue);
        if (result.token !== purchase.current.token) return;
        if (result.status !== "success" && result.status !== "cancelled") return;
        purchase.current.cancelled = result.status === "cancelled";
        // A Stripe redirect is not proof of a credit grant. Verify with the API.
        checkOnReturn();
      } catch { /* Ignore unrelated or malformed cross-tab messages. */ }
    };
    window.addEventListener("focus", checkOnReturn);
    document.addEventListener("visibilitychange", checkOnReturn);
    window.addEventListener("storage", receive);
    return () => {
      mounted.current = false;
      stopPolling();
      window.removeEventListener("focus", checkOnReturn);
      document.removeEventListener("visibilitychange", checkOnReturn);
      window.removeEventListener("storage", receive);
    };
  }, [checkOnReturn, stopPolling]);

  const buy = async (priceId: string) => {
    if (checkoutInFlight.current) return;
    checkoutInFlight.current = true;
    // Open synchronously during the click, before awaiting the checkout API.
    let tab: Window | null = null;
    try {
      tab = window.open("about:blank", "_blank");
      if (tab) tab.opener = null;
    } catch { tab = null; }
    setBusyPrice(priceId);
    setError("");
    setMessage("Creating secure checkout…");
    setCheckoutUrl(null);
    stopPolling();
    purchase.current = null;
    try {
      const token = crypto.randomUUID();
      const result = await createBillingCheckout({
        priceId,
        successUrl: `/pricing?status=success&creditReturn=${encodeURIComponent(token)}`,
        cancelUrl: `/pricing?status=cancelled&creditReturn=${encodeURIComponent(token)}`,
      });
      const url = new URL(result.url);
      if (url.protocol !== "https:") throw new Error("Checkout returned an invalid secure URL. Please try again.");
      if (!mounted.current) { tab?.close(); return; }
      purchase.current = { token, balance: creditsRemaining ?? 0, cancelled: false };
      setCheckoutUrl(result.url);
      if (tab && !tab.closed) {
        try { tab.location.href = result.url; }
        catch { tab.close(); tab = null; }
      } else tab = null;
      setMessage(tab
        ? "Checkout opened in another tab. Keep this Generate tab open and return here after payment or cancellation."
        : "Your browser blocked the checkout tab. Use the secure checkout link below to open it in a new tab.");
    } catch (err) {
      tab?.close();
      if (mounted.current) {
        setMessage("");
        setError(err instanceof Error ? err.message : "Could not start checkout. Please try again.");
      }
    } finally {
      checkoutInFlight.current = false;
      if (mounted.current) setBusyPrice(null);
    }
  };

  const prices = (plans.data?.topups ?? []).flatMap(plan => plan.prices.map(price => ({ plan, price })));
  return (
    <>
      {!open && (message || error) && (
        <div className="fixed bottom-4 right-4 z-50 max-w-sm rounded-lg border bg-background p-3 shadow-lg" role="status" data-testid="status-credit-purchase-summary">
          <p className="text-sm">{error || message}</p>
          <Button variant="outline" className="mt-2" onClick={() => onOpenChange(true)} data-testid="button-review-credit-purchase">Check credits / checkout</Button>
        </div>
      )}
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Buy more credits</DialogTitle>
            <DialogDescription>One-time credit packs use the same prices as Pricing. Checkout opens in another tab. Keep this tab open: your audio uploads, reviewed script, and settings stay here.</DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border p-3 text-sm" data-testid="text-generate-credit-balance">
            This setup needs <strong>{creditsRequired.toLocaleString()}</strong> credits. Your balance: <strong>{creditsRemaining === null ? "Loading…" : creditsRemaining.toLocaleString()}</strong>.
          </div>
          {plans.isLoading && <p role="status"><Loader2 className="inline h-4 w-4 animate-spin mr-2" />Loading credit packs…</p>}
          {plans.isError && <div role="alert" className="text-sm text-destructive">Could not load credit packs. <Button variant="outline" onClick={() => void plans.refetch()} data-testid="button-retry-credit-packs">Retry</Button></div>}
          {!plans.isLoading && !plans.isError && prices.length === 0 && <p>No credit packs are currently available.</p>}
          <div className="space-y-2">
            {prices.map(({ plan, price }) => (
              <Button key={price.id} variant="outline" className="w-full justify-between" disabled={busyPrice !== null || checkoutUrl !== null} onClick={() => void buy(price.id)} data-testid={`button-generate-topup-${price.id}`}>
                <span>{busyPrice === price.id ? <Loader2 className="inline h-4 w-4 animate-spin mr-2" /> : <CreditCard className="inline h-4 w-4 mr-2" />}{plan.name} · {price.credits.toLocaleString()} credits</span>
                <span>{new Intl.NumberFormat("en-US", { style: "currency", currency: price.currency }).format(price.unitAmount / 100)}</span>
              </Button>
            ))}
          </div>
          {message && <p role="status" className="text-sm" data-testid="status-generate-credit-purchase">{message}</p>}
          {error && <p role="alert" className="text-sm text-destructive" data-testid="error-generate-credit-purchase">{error}</p>}
          {checkoutUrl && (
            <div className="space-y-2 text-sm">
              <a href={checkoutUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline" data-testid="link-generate-secure-checkout">Open secure checkout in a new tab</a>
              <p>Cancelled or closed checkout? You can keep editing. To choose a different pack, first close the old checkout tab.</p>
              <Button variant="ghost" onClick={() => { purchase.current = null; stopPolling(); setCheckoutUrl(null); setMessage("Checkout link dismissed. Your setup is unchanged. This does not cancel a payment already completed."); }} data-testid="button-dismiss-credit-checkout">Dismiss checkout link</Button>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={refreshing} onClick={() => { if (purchase.current) checkOnReturn(); else void refresh(); }} data-testid="button-refresh-generate-credits">
              {refreshing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Refresh credits
            </Button>
            <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-keep-editing-generate">Keep editing</Button>
            <a href="/pricing" target="_blank" rel="noopener noreferrer" className="self-center text-sm text-primary underline" data-testid="link-generate-pricing-new-tab">View all plans in a new tab</a>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}