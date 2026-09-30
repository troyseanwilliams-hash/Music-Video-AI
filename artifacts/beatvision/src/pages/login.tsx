import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { useSEO } from "@/hooks/useSEO";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Music2, Wand2, Zap, Film, Eye, EyeOff, Headphones } from "lucide-react";
import { motion } from "framer-motion";
import { FREE_OFFER_COPY } from "@/lib/freeOffer";
import {
  buildAuthUrl,
  getAuthCrossLinkDestination,
  getAuthIntent,
} from "@/lib/authIntent";

const features = [
  {
    icon: Music2,
    title: "Beat Analysis",
    description: "AI detects BPM, mood, and energy from your audio",
  },
  {
    icon: Wand2,
    title: "AI Video Generation",
    description: "Cinematic clips generated to match each section of your track",
  },
  {
    icon: Headphones,
    title: "AI Music",
    description: "Generate royalty-free instrumental music to score your videos",
  },
  {
    icon: Zap,
    title: "Section-Synced Cuts",
    description: "Each clip is timed to your track's energy peaks and structure",
  },
  {
    icon: Film,
    title: "Lyrics Overlay",
    description: "Optional animated lyrics burned into your final video",
  },
];

export default function Login() {
  const { login, isLoading: isAuthLoading } = useAuth();
  const [location, setLocation] = useLocation();
  const authLocation =
    location.includes("?")
      ? location
      : typeof window !== "undefined"
        ? window.location.search
        : location;
  const authIntent = getAuthIntent(authLocation);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useSEO({
    title: "Sign in",
    description: "Sign in to manage your AIBeatSync projects, credits, and subscription.",
    canonical: "/login",
    noindex: true,
  });

  if (isAuthLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await login(email, password);
      // Validate both the legacy `from` key and the newer returnTo key before
      // navigating after sign-in.
      setLocation(authIntent.returnTo);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-h-[calc(100dvh-4rem)] flex">
      {/* Left panel — branding & features */}
      <div className="hidden lg:flex lg:w-1/2 relative bg-gradient-to-br from-[#0d0d1a] via-[#120d2e] to-[#0a0a18] overflow-hidden flex-col justify-between p-12">
        <div className="absolute top-0 left-0 w-[500px] h-[500px] bg-purple-600/20 rounded-full blur-[120px] -translate-x-1/2 -translate-y-1/2 pointer-events-none" />
        <div className="absolute bottom-0 right-0 w-[400px] h-[400px] bg-blue-600/15 rounded-full blur-[100px] translate-x-1/3 translate-y-1/3 pointer-events-none" />

        <div className="relative z-10 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-electric shadow-glow">
            <Music2 className="h-5 w-5 text-white" />
          </div>
          <span className="text-xl font-bold tracking-tight">AIBeatSync</span>
        </div>

        <div className="relative z-10 space-y-8">
          <div>
            <h2 className="text-4xl font-extrabold leading-tight tracking-tight mb-4">
              Your music.<br />
              <span className="bg-gradient-electric bg-clip-text text-transparent">Cinematic visuals.</span>
            </h2>
            <p className="text-muted-foreground text-lg leading-relaxed max-w-sm">
              Upload any track — or generate royalty-free music — and let our AI turn it into a perfectly
              beat-synced music video in minutes.
            </p>
          </div>

          <div className="w-[168px]">
            <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-black shadow-2xl" style={{ aspectRatio: "9 / 16" }}>
              <video
                src="/kling-showcase.mp4"
                poster="/kling-showcase-poster.jpg"
                className="h-full w-full object-cover"
                autoPlay
                muted
                loop
                playsInline
                preload="metadata"
              />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Real AI Short · made with the Kling engine</p>
          </div>

          <div className="grid grid-cols-1 gap-4">
            {features.map((feature, i) => (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.1 + 0.2 }}
                className="flex items-start gap-3"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 border border-primary/20">
                  <feature.icon className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-semibold">{feature.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{feature.description}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        <p className="relative z-10 text-xs text-muted-foreground/60">
          &copy; {new Date().getFullYear()} AIBeatSync. All rights reserved.
        </p>
      </div>

      {/* Right panel — sign-in form */}
      <div className="flex w-full lg:w-1/2 items-center justify-center relative px-4 sm:px-6 py-6 sm:py-12">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-primary/8 rounded-full blur-[120px] pointer-events-none lg:hidden" />

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="w-full max-w-sm relative z-10"
        >
          {/* Mobile logo */}
          <div className="flex items-center gap-2 mb-8 lg:hidden">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-electric shadow-glow">
              <Music2 className="h-4 w-4 text-white" />
            </div>
            <span className="font-bold text-lg">AIBeatSync</span>
          </div>

          <div className="mb-8">
            <h1 className="text-3xl font-bold tracking-tight mb-2">Welcome back</h1>
            <p className="text-muted-foreground text-sm">
              Sign in to create and manage your AI music videos.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4" aria-busy={isSubmitting}>
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
                className="h-11"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <Link href="/forgot-password" className="text-xs text-primary hover:underline">
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  className="h-11 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-controls="password"
                  aria-pressed={showPassword}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Eye className="h-4 w-4" aria-hidden="true" />
                  )}
                </button>
              </div>
            </div>

            {error && (
              <p
                id="login-error"
                role="alert"
                aria-live="assertive"
                className="text-sm break-words text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2"
              >
                {error}
              </p>
            )}

            <Button
              type="submit"
              size="lg"
              disabled={isSubmitting}
              aria-describedby={error ? "login-error" : undefined}
              className="w-full h-12 text-base font-semibold bg-gradient-electric text-white shadow-glow hover:opacity-90 transition-opacity border-0"
            >
              {isSubmitting ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Signing in…</>
              ) : (
                "Sign in"
              )}
            </Button>
            <p role="status" aria-live="polite" className="sr-only">{isSubmitting ? "Signing in. Please wait." : ""}</p>
          </form>

          <p className="text-center text-sm text-muted-foreground mt-6">
            Don't have an account?{" "}
            <Link
              href={buildAuthUrl("/register", {
                returnTo: getAuthCrossLinkDestination(authLocation, authIntent),
                plan: authIntent.plan ?? undefined,
                interval: authIntent.interval ?? undefined,
                topupId: authIntent.topupId ?? undefined,
                referralCode: authIntent.referralCode ?? undefined,
                continueCheckout: authIntent.continueCheckout,
              })}
              className="text-primary hover:underline font-medium"
            >
              Create one free
            </Link>
          </p>
          <p className="mt-3 text-center text-xs text-muted-foreground">{FREE_OFFER_COPY.short} {FREE_OFFER_COPY.credits}</p>

          <p className="text-center text-xs text-muted-foreground/60 mt-6">
            By continuing, you agree to our{" "}
            <span className="underline underline-offset-2 cursor-pointer hover:text-muted-foreground">Terms of Service</span>{" "}
            and{" "}
            <span className="underline underline-offset-2 cursor-pointer hover:text-muted-foreground">Privacy Policy</span>.
          </p>
        </motion.div>
      </div>
    </div>
  );
}
