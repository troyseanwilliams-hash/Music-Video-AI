import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { isAuthTransportError, useAuth } from "@/hooks/useAuth";
import { useSEO } from "@/hooks/useSEO";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Music2, Eye, EyeOff, CheckCircle2, Gift } from "lucide-react";
import { motion } from "framer-motion";
import { track, trackEvent } from "@/lib/analytics";
import {
  AUTH_REGISTER_DEFAULT_DESTINATION,
  buildAuthUrl,
  getAuthCrossLinkDestination,
  getAuthIntent,
} from "@/lib/authIntent";

type SignupValidationCategory =
  | "name_required"
  | "name_too_long"
  | "email_required"
  | "email_invalid"
  | "password_mismatch"
  | "password_too_short";

export default function Register() {
  const { register } = useAuth();
  const [location, setLocation] = useLocation();
  const authLocation =
    location.includes("?")
      ? location
      : typeof window !== "undefined"
        ? window.location.search
        : location;
  const authIntent = useMemo(
    () => getAuthIntent(authLocation, AUTH_REGISTER_DEFAULT_DESTINATION),
    [authLocation],
  );
  const referralCode = authIntent.referralCode;
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const passwordStrong = password.length >= 8;

  useSEO({
    title: "Create your account",
    description:
      "Start a 7-day AIBeatSync trial with zero starting credits, excluding valid referral or promotional grants, plus three lifetime free instrumentals and one lifetime free vocal song.",
    canonical: "/register",
    noindex: true,
  });

  function validationFailure(
    category: SignupValidationCategory,
    message: string,
  ): void {
    track("signup_validation_failed", { category });
    setError(message);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      validationFailure("name_required", "Enter your full name to continue.");
      return;
    }
    if (name.trim().length > 100) {
      validationFailure("name_too_long", "Your name must be 100 characters or fewer.");
      return;
    }
    if (!email.trim()) {
      validationFailure("email_required", "Enter your email address to continue.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      validationFailure("email_invalid", "Enter a valid email address.");
      return;
    }
    if (password !== confirmPassword) {
      validationFailure("password_mismatch", "Passwords don't match.");
      return;
    }
    if (password.length < 8) {
      validationFailure("password_too_short", "Password must be at least 8 characters.");
      return;
    }

    setIsSubmitting(true);
    trackEvent("signup_started", { has_referral: Boolean(referralCode) });
    try {
      await register(name.trim(), email.trim(), password, referralCode ?? undefined);
      // Account creation is tracked authoritatively by the server. Keep the
      // selected plan as an explicit next step; never start checkout here.
      setLocation(authIntent.returnTo);
    } catch (err) {
      if (isAuthTransportError(err)) {
        track("signup_transport_failed", { category: "network" });
        setError(err.message);
      } else {
        // HTTP failures are tracked authoritatively by the server. Do not emit
        // a second client-side failure event for the same response.
        setError(err instanceof Error ? err.message : "Registration failed");
      }
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
        {/* Logo */}
        <div className="flex items-center gap-2 mb-8">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-electric shadow-glow">
            <Music2 className="h-4 w-4 text-white" />
          </div>
          <span className="font-bold text-lg">AIBeatSync</span>
        </div>

        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight mb-2">Create your account</h1>
          <p className="text-muted-foreground text-sm">
              Your 7-day trial starts with zero credits, excluding valid referral or
              promotional grants. You also get three lifetime free instrumentals and one
              lifetime free vocal song.
          </p>
        </div>

        {referralCode && (
          <div className="mb-6 flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm" data-testid="banner-referral">
            <Gift className="h-4 w-4 text-primary shrink-0" />
            <span>You were invited — you'll get <span className="font-semibold">50 bonus credits</span> when you sign up.</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Full name</Label>
            <Input
              id="name"
              type="text"
              placeholder="Jane Smith"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoComplete="name"
              aria-invalid={Boolean(error && !name.trim())}
              className="h-11"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              aria-invalid={Boolean(error && !email.trim())}
              className="h-11"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
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
                aria-describedby="password-requirement"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-controls="password confirmPassword"
                aria-pressed={showPassword}
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Eye className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            </div>
            {password.length > 0 && (
              <div id="password-requirement" className="flex items-center gap-1.5 text-xs">
                <CheckCircle2 className={`h-3.5 w-3.5 ${passwordStrong ? "text-green-500" : "text-muted-foreground/40"}`} />
                <span className={passwordStrong ? "text-green-500" : "text-muted-foreground/60"}>
                  At least 8 characters
                </span>
              </div>
            )}
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
              aria-label="Confirm password"
            />
          </div>

          {error && (
            <p
              id="signup-error"
              role="alert"
              aria-live="assertive"
              className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2"
            >
              {error}
            </p>
          )}

          <Button
            type="submit"
            size="lg"
            disabled={isSubmitting}
            aria-describedby={error ? "signup-error" : undefined}
            className="w-full h-12 text-base font-semibold bg-gradient-electric text-white shadow-glow hover:opacity-90 transition-opacity border-0"
          >
            {isSubmitting ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creating account…</>
            ) : (
              "Create account"
            )}
          </Button>
        </form>

        <p className="text-center text-sm text-muted-foreground mt-6">
          Already have an account?{" "}
          <Link
            href={buildAuthUrl("/login", {
              returnTo: getAuthCrossLinkDestination(authLocation, authIntent),
              plan: authIntent.plan ?? undefined,
              interval: authIntent.interval ?? undefined,
              topupId: authIntent.topupId ?? undefined,
              referralCode,
              continueCheckout: authIntent.continueCheckout,
            })}
            className="text-primary hover:underline font-medium"
          >
            Sign in
          </Link>
        </p>

        <p className="text-center text-xs text-muted-foreground/60 mt-4">
          By creating an account, you agree to our{" "}
          <Link href="/terms" className="underline underline-offset-2 hover:text-muted-foreground">Terms of Service</Link>{" "}
          and{" "}
          <Link href="/privacy" className="underline underline-offset-2 hover:text-muted-foreground">Privacy Policy</Link>.
        </p>
      </motion.div>
    </div>
  );
}
