import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search, ShieldCheck, Coins, Check, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface AdminUser {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  subscriptionStatus: string;
  createdAt: string;
  creditsRemaining: number;
  subscriptionCredits: number;
  topupCredits: number;
  creditsUsed: number;
  totalGenerations: number;
}

async function fetchAdminUsers(search: string): Promise<AdminUser[]> {
  const params = search ? `?search=${encodeURIComponent(search)}` : "";
  const res = await fetch(`/api/admin/users${params}`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch users");
  const data = await res.json();
  return data.users;
}

async function setUserCredits(userId: string, amount: number): Promise<void> {
  const res = await fetch("/api/admin/credits/set", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ userId, amount }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error || "Failed to update credits");
  }
}

function statusColor(status: string) {
  switch (status) {
    case "active": return "bg-green-500/15 text-green-600 border-green-500/30";
    case "trial": return "bg-blue-500/15 text-blue-600 border-blue-500/30";
    case "cancelled": return "bg-red-500/15 text-red-500 border-red-500/30";
    default: return "bg-muted text-muted-foreground border-border";
  }
}

function CreditCell({ user, onSaved }: { user: AdminUser; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(user.creditsRemaining));
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: (amount: number) => setUserCredits(user.id, amount),
    onSuccess: () => {
      toast({ title: "Credits updated", description: `${user.email} → ${value} credits` });
      setEditing(false);
      onSaved();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  function handleSave() {
    const parsed = parseInt(value, 10);
    if (isNaN(parsed) || parsed < 0) {
      toast({ title: "Invalid amount", description: "Enter a non-negative integer", variant: "destructive" });
      return;
    }
    mutation.mutate(parsed);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") handleSave();
    if (e.key === "Escape") { setEditing(false); setValue(String(user.creditsRemaining)); }
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <Input
          className="h-7 w-24 text-sm px-2"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus
          type="number"
          min={0}
        />
        <Button size="icon" className="h-7 w-7" onClick={handleSave} disabled={mutation.isPending}>
          {mutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
        </Button>
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditing(false); setValue(String(user.creditsRemaining)); }}>
          <X className="h-3 w-3" />
        </Button>
      </div>
    );
  }

  return (
    <button
      onClick={() => { setValue(String(user.creditsRemaining)); setEditing(true); }}
      className="flex items-center gap-1.5 text-sm font-medium text-accent hover:underline underline-offset-2 cursor-pointer group"
      title="Click to edit"
    >
      <Coins className="h-3.5 w-3.5 shrink-0" />
      <span>{user.creditsRemaining.toLocaleString()}</span>
      <span className="text-xs text-muted-foreground font-normal opacity-0 group-hover:opacity-100 transition-opacity">
        ({user.subscriptionCredits}+{user.topupCredits})
      </span>
    </button>
  );
}

export default function AdminPage() {
  const [, setLocation] = useLocation();
  const { user, isLoading: isAuthLoading } = useAuth();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const queryClient = useQueryClient();

  const isAdmin = user?.isAdmin ?? false;

  const { data: users, isLoading, error, refetch } = useQuery({
    queryKey: ["admin", "users", debouncedSearch],
    queryFn: () => fetchAdminUsers(debouncedSearch),
    enabled: isAdmin,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!isAuthLoading && !isAdmin) {
      setLocation("/");
    }
  }, [isAuthLoading, isAdmin, setLocation]);

  if (isAuthLoading || (!isAdmin && !isAuthLoading)) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  function handleSearchChange(e: React.ChangeEvent<HTMLInputElement>) {
    setSearch(e.target.value);
    clearTimeout((window as unknown as { _adminSearchTimer?: ReturnType<typeof setTimeout> })._adminSearchTimer);
    (window as unknown as { _adminSearchTimer?: ReturnType<typeof setTimeout> })._adminSearchTimer = setTimeout(() => {
      setDebouncedSearch(e.target.value);
    }, 350);
  }

  return (
    <div className="container mx-auto px-4 py-12 max-w-6xl">
      <div className="flex items-center gap-3 mb-8">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
          <ShieldCheck className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Admin</h1>
          <p className="text-sm text-muted-foreground">Manage user accounts and credits</p>
        </div>
      </div>

      <Card className="bg-card/50 border-card-border">
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <CardTitle className="text-lg">Users</CardTitle>
              <CardDescription>
                {users ? `${users.length} user${users.length !== 1 ? "s" : ""}${debouncedSearch ? " matching" : ""}` : "Loading…"}
              </CardDescription>
            </div>
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                className="pl-9"
                placeholder="Search by email or name…"
                value={search}
                onChange={handleSearchChange}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="py-12 text-center text-sm text-destructive">
              Failed to load users.{" "}
              <button onClick={() => refetch()} className="underline">Retry</button>
            </div>
          ) : !users || users.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              {debouncedSearch ? "No users match your search." : "No users found."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/50 bg-muted/20">
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">User</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground hidden md:table-cell">Status</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Credits</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground hidden lg:table-cell">Generations</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground hidden lg:table-cell">Joined</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {users.map((u) => (
                    <tr key={u.id} className="hover:bg-muted/10 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium truncate max-w-[200px]">
                          {u.firstName || u.lastName
                            ? [u.firstName, u.lastName].filter(Boolean).join(" ")
                            : <span className="text-muted-foreground italic">No name</span>}
                        </div>
                        <div className="text-xs text-muted-foreground truncate max-w-[200px]">{u.email}</div>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <Badge variant="outline" className={`capitalize text-xs ${statusColor(u.subscriptionStatus)}`}>
                          {u.subscriptionStatus}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <CreditCell
                          user={u}
                          onSaved={() => queryClient.invalidateQueries({ queryKey: ["admin", "users"] })}
                        />
                      </td>
                      <td className="px-4 py-3 text-right text-muted-foreground hidden lg:table-cell">
                        {u.totalGenerations}
                      </td>
                      <td className="px-4 py-3 text-right text-muted-foreground hidden lg:table-cell">
                        {new Date(u.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
