import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AUTH_QUERY_KEY, useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { tutorialsEnabled, setTutorialsEnabled } from "@/components/TutorialTip";
import { Loader2, User, Bell, KeyRound, CreditCard } from "lucide-react";

export default function Settings() {
  const { user, isAuthenticated, isLoading } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [tipsOn, setTipsOn] = useState(true);
  useEffect(() => { setTipsOn(tutorialsEnabled()); }, []);

  useEffect(() => {
    if (user) {
      setFirstName(user.firstName ?? "");
      setLastName(user.lastName ?? "");
    }
  }, [user]);

  const { data: prefs } = useQuery({
    queryKey: ["auth", "preferences"],
    queryFn: async () => {
      const res = await fetch("/api/auth/preferences", { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json() as Promise<{ notifyOnComplete: boolean }>;
    },
    enabled: isAuthenticated,
  });

  const saveProfile = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/auth/profile", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName, lastName }),
      });
      if (!res.ok) throw new Error("Save failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: AUTH_QUERY_KEY });
      toast({ title: "Profile saved" });
    },
    onError: () => toast({ title: "Couldn't save", variant: "destructive" }),
  });

  const saveNotify = useMutation({
    mutationFn: async (notifyOnComplete: boolean) => {
      const res = await fetch("/api/auth/preferences", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notifyOnComplete }),
      });
      if (!res.ok) throw new Error("Save failed");
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["auth", "preferences"] }),
    onError: () => toast({ title: "Couldn't update", variant: "destructive" }),
  });

  if (isLoading) {
    return <div className="flex items-center justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }
  if (!isAuthenticated) {
    return (
      <div className="container mx-auto px-4 py-16 text-center">
        <h1 className="mb-2 text-xl font-semibold">Account settings</h1>
        <p className="mb-6 text-muted-foreground">Sign in to manage your account.</p>
        <Link href="/login"><Button className="border-0 bg-gradient-electric text-white">Sign in</Button></Link>
      </div>
    );
  }

  const nameChanged = firstName !== (user?.firstName ?? "") || lastName !== (user?.lastName ?? "");

  return (
    <div className="container mx-auto max-w-2xl px-4 py-10">
      <h1 className="mb-6 text-2xl font-bold tracking-tight">Account settings</h1>

      <Card className="mb-6 bg-card/50 border-card-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg"><User className="h-5 w-5 text-primary" /> Profile</CardTitle>
          <CardDescription>Your display name, shown on shared work.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium">First name</label>
              <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} maxLength={60} />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Last name</label>
              <Input value={lastName} onChange={(e) => setLastName(e.target.value)} maxLength={60} />
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Email</label>
            <Input value={user?.email ?? ""} disabled />
            <p className="mt-1 text-xs text-muted-foreground">Contact support to change your email.</p>
          </div>
          <Button
            className="border-0 bg-gradient-electric text-white"
            disabled={!nameChanged || saveProfile.isPending}
            onClick={() => saveProfile.mutate()}
          >
            {saveProfile.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save changes
          </Button>
        </CardContent>
      </Card>

      <Card className="mb-6 bg-card/50 border-card-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg"><Bell className="h-5 w-5 text-primary" /> Notifications</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Email me when a render finishes</p>
              <p className="text-xs text-muted-foreground">Get a note the moment your video or export is ready.</p>
            </div>
            <Switch
              checked={prefs?.notifyOnComplete ?? true}
              onCheckedChange={(v) => saveNotify.mutate(v)}
            />
          </div>
          <div className="mt-4 flex items-center justify-between gap-4 border-t border-border/40 pt-4">
            <div>
              <p className="text-sm font-medium">Show tutorial tips</p>
              <p className="text-xs text-muted-foreground">Helpful hints on the Generate, Remix, and Soundtracks pages.</p>
            </div>
            <Switch
              checked={tipsOn}
              onCheckedChange={(v) => { setTutorialsEnabled(v); setTipsOn(v); toast({ title: v ? "Tips on" : "Tips off" }); }}
            />
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card/50 border-card-border">
        <CardHeader>
          <CardTitle className="text-lg">Security &amp; billing</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Link href="/forgot-password">
            <Button variant="outline" className="w-full justify-start sm:w-auto"><KeyRound className="mr-2 h-4 w-4" /> Change password</Button>
          </Link>
          <Link href="/pricing">
            <Button variant="outline" className="w-full justify-start sm:w-auto"><CreditCard className="mr-2 h-4 w-4" /> Manage billing &amp; plan</Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
