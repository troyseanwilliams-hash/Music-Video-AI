import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { startAnalytics, trackPageview } from "@/lib/analytics";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import NotFound from "@/pages/not-found";

import Home from "@/pages/home";
import Login from "@/pages/login";
import Register from "@/pages/register";
import Generate from "@/pages/generate";
import Editor from "@/pages/editor";
import Dashboard from "@/pages/dashboard";
import Gallery from "@/pages/gallery";
import Soundtracks from "@/pages/soundtracks";
import SharedSoundtrack from "@/pages/shared-soundtrack";
import Explore from "@/pages/explore";
import JobStatus from "@/pages/job-status";
import Pricing from "@/pages/pricing";
import Admin from "@/pages/admin";
import Terms from "@/pages/terms";
import Dmca from "@/pages/dmca";
import Support from "@/pages/support";
import Settings from "@/pages/settings";
import PromptStudio from "@/pages/prompt-studio";
import SunoLanding from "@/pages/suno-landing";
import CanvasLanding from "@/pages/canvas-landing";
import { AiMusicVideoLanding, LyricVideoLanding, InstrumentalLanding } from "@/pages/use-case-landing";
import ForgotPassword from "@/pages/forgot-password";
import ResetPassword from "@/pages/reset-password";
import Redeem from "@/pages/redeem";

const queryClient = new QueryClient();

// Fires a pageview on every route change and records time-on-page. Rendered
// inside the router so it sees wouter's location.
function AnalyticsTracker() {
  const [location] = useLocation();
  useEffect(() => { startAnalytics(); }, []);
  useEffect(() => { trackPageview(location); }, [location]);
  return null;
}

function Router() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col font-sans">
      {/* Keyboard/screen-reader skip link — first focusable element on the page */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white focus:shadow-glow"
      >
        Skip to main content
      </a>
      <AnalyticsTracker />
      <Navbar />
      <main id="main-content" tabIndex={-1} className="flex-1 flex flex-col outline-none">
        <Switch>
          <Route path="/" component={Home} />
          <Route path="/login" component={Login} />
          <Route path="/register" component={Register} />
          <Route path="/forgot-password" component={ForgotPassword} />
          <Route path="/reset-password" component={ResetPassword} />
          <Route path="/generate" component={Generate} />
          <Route path="/editor" component={Editor} />
          <Route path="/dashboard" component={Dashboard} />
          <Route path="/gallery" component={Gallery} />
          <Route path="/soundtracks" component={Soundtracks} />
          <Route path="/prompt-studio" component={PromptStudio} />
          <Route path="/s/:token" component={SharedSoundtrack} />
          <Route path="/explore" component={Explore} />
          <Route path="/jobs/:id" component={JobStatus} />
          <Route path="/pricing" component={Pricing} />
          <Route path="/redeem" component={Redeem} />
          <Route path="/admin" component={Admin} />
          <Route path="/terms" component={Terms} />
          <Route path="/dmca" component={Dmca} />
          <Route path="/support" component={Support} />
          <Route path="/settings" component={Settings} />
          <Route path="/suno" component={SunoLanding} />
          <Route path="/spotify-canvas" component={CanvasLanding} />
          <Route path="/ai-music-video-generator" component={AiMusicVideoLanding} />
          <Route path="/ai-lyric-video" component={LyricVideoLanding} />
          <Route path="/instrumental-generator" component={InstrumentalLanding} />
          <Route component={NotFound} />
        </Switch>
      </main>
      <Footer />
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
