import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Music2, Eye, EyeOff, CheckCircle2 } from "lucide-react";
import { motion } from "framer-motion";

export default function ResetPassword() {
  const [, setLocation] = useLocation();
  const token = useMemo(
    () => new URLSearchParams(window.location.search).get("token") ?? "",
    [],
  );
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const passwordStrong = password.length >= 8;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError("Passwords don't match");
      return;
    }
    if (!passwordStrong) {
      setError("Password must be at least 8 characters");
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Reset failed");
      setDone(true);
      setTimeout(() => setLocation("/login"), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center relative overflow-hidden px-6 py-12">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary/8 rounded-full blur-[140px] pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-sm relative z-10"
      >
        <div className="flex items-center gap-2 mb-8">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-electric shadow-glow">
            <Music2 className="h-4 w-4 text-white" />
          </div>
          <span className="font-bold text-lg">AI Beat Sync</span>
        </div>

        {done ? (
          <div className="text-center">
            <CheckCircle2 className="h-10 w-10 text-green-500 mx-auto mb-4" />
            <h1 className="text-2xl font-bold tracking-tight mb-2">Password updated</h1>
            <p className="text-muted-foreground text-sm">
              Taking you to sign in…
            </p>
          </div>
        ) : !token ? (
          <div className="text-center">
            <h1 className="text-2xl font-bold tracking-tight mb-2">Invalid link</h1>
            <p className="text-muted-foreground text-sm mb-6">
              This reset link is missing its token.{" "}
            </p>
            <Link href="/forgot-password" className="text-primary hover:underline text-sm font-medium">
              Request a new reset link
            </Link>
          </div>
        ) : (
          <>
            <div className="mb-8">
              <h1 className="text-3xl font-bold tracking-tight mb-2">Choose a new password</h1>
              <p className="text-muted-foreground text-sm">
                Make it at least 8 characters.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4" autoComplete="off">
              <div className="space-y-2">
                <Label htmlFor="password">New password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="At least 8 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="new-password"
                    className="h-11 pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm password</Label>
                <Input
                  id="confirmPassword"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  className="h-11"
                />
              </div>

              {error && (
                <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}

              <Button
                type="submit"
                size="lg"
                disabled={isSubmitting}
                className="w-full h-12 text-base font-semibold bg-gradient-electric text-white shadow-glow hover:opacity-90 transition-opacity border-0"
              >
                {isSubmitting ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Updating…</>
                ) : (
                  "Update password"
                )}
              </Button>
            </form>
          </>
        )}
      </motion.div>
    </div>
  );
}
