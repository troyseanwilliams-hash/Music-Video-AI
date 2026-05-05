import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Music2, Wand2, Zap, Film, Eye, EyeOff } from "lucide-react";
import { motion } from "framer-motion";

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
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      setLocation("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] flex">
      {/* Left panel — branding & features */}
      <div className="hidden lg:flex lg:w-1/2 relative bg-gradient-to-br from-[#0d0d1a] via-[#120d2e] to-[#0a0a18] overflow-hidden flex-col justify-between p-12">
        <div className="absolute top-0 left-0 w-[500px] h-[500px] bg-purple-600/20 rounded-full blur-[120px] -translate-x-1/2 -translate-y-1/2 pointer-events-none" />
        <div className="absolute bottom-0 right-0 w-[400px] h-[400px] bg-blue-600/15 rounded-full blur-[100px] translate-x-1/3 translate-y-1/3 pointer-events-none" />

        <div className="relative z-10 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-electric shadow-glow">
            <Music2 className="h-5 w-5 text-white" />
          </div>
          <span className="text-xl font-bold tracking-tight">AI Beat Sync</span>
        </div>

        <div className="relative z-10 space-y-8">
          <div>
            <h2 className="text-4xl font-extrabold leading-tight tracking-tight mb-4">
              Your music.<br />
              <span className="bg-gradient-electric bg-clip-text text-transparent">Cinematic visuals.</span>
            </h2>
            <p className="text-muted-foreground text-lg leading-relaxed max-w-sm">
              Upload any track and let our AI compose a perfectly beat-synced music video in minutes.
            </p>
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
          &copy; {new Date().getFullYear()} AI Beat Sync. All rights reserved.
        </p>
      </div>

      {/* Right panel — sign-in form */}
      <div className="flex w-full lg:w-1/2 items-center justify-center relative overflow-hidden px-6 py-12">
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
            <span className="font-bold text-lg">AI Beat Sync</span>
          </div>

          <div className="mb-8">
            <h1 className="text-3xl font-bold tracking-tight mb-2">Welcome back</h1>
            <p className="text-muted-foreground text-sm">
              Sign in to create and manage your AI music videos.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4" autoComplete="off">
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
              <Label htmlFor="password">Password</Label>
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
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
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
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Signing in…</>
              ) : (
                "Sign in"
              )}
            </Button>
          </form>

          <p className="text-center text-sm text-muted-foreground mt-6">
            Don't have an account?{" "}
            <Link href="/register" className="text-primary hover:underline font-medium">
              Create one free
            </Link>
          </p>

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
