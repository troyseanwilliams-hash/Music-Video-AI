import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Gift, CheckCircle2, Sparkles } from "lucide-react";

type Result =
  | { state: "idle" }
  | { state: "working" }
  | { state: "success"; message: string; trialEndsAt?: string }
  | { state: "error"; message: string };

export default function Redeem() {
  const { isAuthenticated, isLoading } = useAuth();
  const [, navigate] = useLocation();
  const [code, setCode] = useState("");
  const [result, setResult] = useState<Result>({ state: "idle" });
  const autoTried = useRef(false);

  // Prefill from ?code=… (e.g. the email link /redeem?code=COMEBACK7).
  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get("code");
    if (c) setCode(c.trim().toUpperCase());
  }, []);

  const redeem = async (rawCode: string) => {
    const value = rawCode.trim().toUpperCase();
    if (value.length < 2) return;
    setResult({ state: "working" });
    try {
      const res = await fetch("/api/promo/redeem", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: value }),
      });
      const data = await res.json();
      if (!res.ok) {
        setResult({ state: "error", message: data.error || "That code couldn't be redeemed." });
        return;
      }
      setResult({ state: "success", message: data.message || "Your free time has been added.", trialEndsAt: data.trialEndsAt });
    } catch {
      setResult({ state: "error", message: "Something went wrong. Please try again." });
    }
  };

  // Auto-redeem once, when signed in and a code is present in the URL.
  useEffect(() => {
    if (autoTried.current) return;
    if (isLoading || !isAuthenticated) return;
    const c = new URLSearchParams(window.location.search).get("code");
    if (c) {
      autoTried.current = true;
      redeem(c);
    }
  }, [isLoading, isAuthenticated]);

  if (isLoading) {
    return <div className="min-h-[60vh] flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  // Not signed in — send them to log in, preserving the code so it applies after.
  if (!isAuthenticated) {
    const from = encodeURIComponent(`/redeem${code ? `?code=${code}` : ""}`);
    return (
      <div className="container mx-auto px-4 py-20 max-w-md text-center">
        <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-electric shadow-glow mb-4">
          <Gift className="h-7 w-7 text-white" />
        </div>
        <h1 className="text-2xl font-bold mb-2">Redeem your code</h1>
        <p className="text-muted-foreground mb-6">
          {code ? <>Sign in to apply code <strong className="text-foreground">{code}</strong> to your account.</> : "Sign in to redeem a promo code."}
        </p>
        <div className="flex flex-col gap-2">
          <Link href={`/login?from=${from}`}><Button size="lg" className="w-full bg-gradient-electric text-white border-0">Sign in</Button></Link>
          <Link href="/register"><Button size="lg" variant="outline" className="w-full">Create an account</Button></Link>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-16 sm:py-20 max-w-md">
      <div className="text-center mb-8">
        <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-electric shadow-glow mb-4">
          <Gift className="h-7 w-7 text-white" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Redeem a code</h1>
        <p className="text-muted-foreground mt-2">Enter your promo code to unlock your reward.</p>
      </div>

      {result.state === "success" ? (
        <div className="rounded-2xl border border-green-500/30 bg-green-500/10 p-6 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-green-500 mb-3" />
          <p className="text-lg font-semibold text-foreground mb-1">{result.message}</p>
          {result.trialEndsAt && (
            <p className="text-sm text-muted-foreground mb-5">
              Your free access now runs through <strong className="text-foreground">{new Date(result.trialEndsAt).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}</strong>.
            </p>
          )}
          <div className="flex flex-col sm:flex-row gap-2 justify-center">
            <Link href="/soundtracks"><Button className="w-full sm:w-auto bg-gradient-electric text-white border-0"><Sparkles className="h-4 w-4 mr-2" /> Explore new features</Button></Link>
            <Link href="/editor"><Button variant="outline" className="w-full sm:w-auto">Open Remix Lab</Button></Link>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-card-border bg-card/50 p-6 space-y-4">
          <div>
            <label className="text-sm font-medium">Promo code</label>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => { if (e.key === "Enter") redeem(code); }}
              placeholder="e.g. COMEBACK7"
              className="mt-1.5 tracking-widest font-mono"
              autoFocus
            />
          </div>
          {result.state === "error" && (
            <p className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">{result.message}</p>
          )}
          <Button
            onClick={() => redeem(code)}
            disabled={result.state === "working" || code.trim().length < 2}
            className="w-full bg-gradient-electric text-white border-0"
          >
            {result.state === "working" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Gift className="h-4 w-4 mr-2" />}
            Redeem code
          </Button>
          <p className="text-xs text-muted-foreground text-center">
            Codes apply to your current account. <Link href="/pricing" className="text-primary underline underline-offset-2">See plans</Link> for full access.
          </p>
        </div>
      )}
    </div>
  );
}
