import { useListBillingGrants, getListBillingGrantsQueryKey, type DashboardStats } from "@workspace/api-client-react";
import { Coins, ExternalLink, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Date unavailable"
    : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function DashboardCreditBalance({
  stats,
  welcomeExpiresAt,
}: {
  stats: Pick<DashboardStats, "creditsRemaining" | "welcomeCredits" | "subscriptionCredits" | "topupCredits">;
  welcomeExpiresAt: string | null;
}) {
  const expired = welcomeExpiresAt !== null && new Date(welcomeExpiresAt).getTime() <= Date.now();
  return (
    <Card className="bg-card/50 border-card-border" data-testid="card-credits-remaining">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">Credits Remaining</CardTitle>
        <Coins className="h-4 w-4 text-accent" />
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold" data-testid="text-credits-total">{stats.creditsRemaining}</div>
        <dl className="mt-3 space-y-2 text-xs" data-testid="text-credits-breakdown">
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">Welcome</dt>
            <dd className="font-medium" data-testid="text-welcome-credits">{stats.welcomeCredits}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">Subscription</dt>
            <dd className="font-medium" data-testid="text-subscription-credits">{stats.subscriptionCredits}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">Purchased / non-expiring</dt>
            <dd className="font-medium" data-testid="text-purchased-credits">{stats.topupCredits}</dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-muted-foreground" data-testid="text-welcome-expiration">
          {welcomeExpiresAt
            ? <>Welcome credits {expired ? "expired" : "expire"} <time dateTime={welcomeExpiresAt} title={new Date(welcomeExpiresAt).toLocaleString()}>{formatDate(welcomeExpiresAt)}</time>. {expired ? "Expired welcome credits are not included in your balance." : "Unused welcome credits expire within your first 7 days."}</>
            : stats.welcomeCredits > 0
              ? "Welcome credit expiration date unavailable."
              : "No expiring welcome credits."}
        </p>
      </CardContent>
    </Card>
  );
}

const SOURCE_LABELS: Record<string, string> = {
  trial: "Welcome grant",
  subscription: "Subscription credits",
  topup: "Purchased credits",
  admin: "Admin credit grant",
};

export function DashboardCreditHistory({ userId }: { userId: string }) {
  const history = useListBillingGrants({
    query: {
      queryKey: [...getListBillingGrantsQueryKey(), userId],
      enabled: Boolean(userId),
      staleTime: 30_000,
      refetchInterval: 60_000,
      refetchOnMount: "always",
    },
  });

  return (
    <Card className="bg-card/50 border-card-border" data-testid="card-credit-history">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Coins className="h-5 w-5 text-primary" /> Credit History</CardTitle>
        <p className="text-sm text-muted-foreground">
          Your latest 50 credit grants, newest first. These are credits added, not a spending ledger or your remaining balance.
          Purchased credits do not expire; the non-expiring balance can also include older welcome grants and other awarded credits.
        </p>
      </CardHeader>
      <CardContent>
        {history.isLoading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status" data-testid="status-credit-history-loading">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading credit history…
          </p>
        ) : history.isError ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3" data-testid="status-credit-history-error">
            <p className="text-sm text-destructive">Could not load credit history. Please try again.</p>
            <Button variant="outline" size="sm" disabled={history.isFetching} onClick={() => void history.refetch()} data-testid="button-retry-credit-history">Try again</Button>
          </div>
        ) : history.data?.grants.length ? (
          <div className="max-h-80 overflow-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Recent credit grants</caption>
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b border-border">
                  <th scope="col" className="pb-3 pr-3">Date</th>
                  <th scope="col" className="pb-3 pr-3">Source</th>
                  <th scope="col" className="pb-3 pr-3 text-right">Credits added</th>
                  <th scope="col" className="pb-3 text-right">Receipt</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {history.data.grants.map((grant) => (
                  <tr key={grant.id} data-testid={`row-credit-grant-${grant.id}`}>
                    <td className="py-3 pr-3 text-muted-foreground"><time dateTime={grant.createdAt}>{formatDate(grant.createdAt)}</time></td>
                    <td className="py-3 pr-3">{SOURCE_LABELS[grant.source] ?? grant.source}</td>
                    <td className="py-3 pr-3 text-right font-medium tabular-nums" data-testid={`text-grant-amount-${grant.id}`}>{grant.creditsGranted > 0 ? "+" : ""}{grant.creditsGranted}</td>
                    <td className="py-3 text-right">
                      {grant.receiptUrl ? (
                        <a href={grant.receiptUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline" aria-label={`View receipt for ${SOURCE_LABELS[grant.source] ?? grant.source}`} data-testid={`link-credit-receipt-${grant.id}`}>
                          View <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : <span className="text-xs text-muted-foreground">Not available</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground" data-testid="status-credit-history-empty">No credit grants recorded yet.</p>
        )}
      </CardContent>
    </Card>
  );
}