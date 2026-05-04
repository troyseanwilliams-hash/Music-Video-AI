import { useAuth } from "@workspace/replit-auth-web";
import { Button } from "@/components/ui/button";
import { Loader2, Music2, Wand2, Zap, Film } from "lucide-react";
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
    title: "Beat-Synced Cuts",
    description: "Every edit lands precisely on the beat — automatically",
  },
  {
    icon: Film,
    title: "Lyrics Overlay",
    description: "Optional animated lyrics burned into your final video",
  },
];

export default function Login() {
  const { login, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] flex">
      {/* Left panel — branding & features */}
      <div className="hidden lg:flex lg:w-1/2 relative bg-gradient-to-br from-[#0d0d1a] via-[#120d2e] to-[#0a0a18] overflow-hidden flex-col justify-between p-12">
        {/* Background glows */}
        <div className="absolute top-0 left-0 w-[500px] h-[500px] bg-purple-600/20 rounded-full blur-[120px] -translate-x-1/2 -translate-y-1/2 pointer-events-none" />
        <div className="absolute bottom-0 right-0 w-[400px] h-[400px] bg-blue-600/15 rounded-full blur-[100px] translate-x-1/3 translate-y-1/3 pointer-events-none" />

        {/* Logo */}
        <div className="relative z-10 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-electric shadow-glow">
            <Music2 className="h-5 w-5 text-white" />
          </div>
          <span className="text-xl font-bold tracking-tight">Syncbeat.ai</span>
        </div>

        {/* Hero copy */}
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
            {features.map((feature) => (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: features.indexOf(feature) * 0.1 + 0.2 }}
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

        {/* Footer */}
        <p className="relative z-10 text-xs text-muted-foreground/60">
          &copy; {new Date().getFullYear()} Syncbeat.ai. All rights reserved.
        </p>
      </div>

      {/* Right panel — sign-in card */}
      <div className="flex w-full lg:w-1/2 items-center justify-center relative overflow-hidden px-6 py-12">
        {/* Mobile background glow */}
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
            <span className="font-bold text-lg">Syncbeat.ai</span>
          </div>

          <div className="mb-8">
            <h1 className="text-3xl font-bold tracking-tight mb-2">Welcome back</h1>
            <p className="text-muted-foreground text-sm">
              Sign in to create and manage your AI music videos.
            </p>
          </div>

          <div className="space-y-4">
            <Button
              size="lg"
              className="w-full h-12 text-base font-semibold bg-gradient-electric text-white shadow-glow hover:opacity-90 transition-opacity border-0"
              onClick={login}
            >
              Continue with Replit
            </Button>

            <div className="relative flex items-center gap-3">
              <div className="flex-1 h-px bg-border/60" />
              <span className="text-xs text-muted-foreground/60">secure sign-in</span>
              <div className="flex-1 h-px bg-border/60" />
            </div>

            <div className="rounded-xl border border-border/50 bg-secondary/30 p-4 space-y-2">
              {["Beat-synced video generation", "Cloud storage for your videos", "Real-time job progress tracking"].map((item) => (
                <div key={item} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <div className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                  {item}
                </div>
              ))}
            </div>
          </div>

          <p className="text-center text-xs text-muted-foreground/60 mt-8">
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
