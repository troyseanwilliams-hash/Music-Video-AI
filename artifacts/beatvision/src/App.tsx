import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { useEffect, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { startAnalytics, trackPageview } from "@/lib/analytics";
import { ScrollToTop } from "@/components/ScrollToTop";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import NotFound from "@/pages/not-found";

import Home from "@/pages/home";
import Login from "@/pages/login";
import Register from "@/pages/register";
import Generate from "@/pages/generate";
import CreateImages from "@/pages/images";
import { imageCreationRedirect } from "@/lib/imageCreation";
import Editor from "@/pages/editor";
import Dashboard from "@/pages/dashboard";
import Gallery from "@/pages/gallery";
import Soundtracks from "@/pages/soundtracks";
import SharedSoundtrack from "@/pages/shared-soundtrack";
import Explore from "@/pages/explore";
import PublicImageDetail from "@/pages/public-image";
import JobStatus from "@/pages/job-status";
import Pricing from "@/pages/pricing";
import Admin from "@/pages/admin";
import AdminRunwayLipSync from "@/pages/admin-runway-lipsync";
import Terms from "@/pages/terms";
import Dmca from "@/pages/dmca";
import Privacy from "@/pages/privacy";
import Support from "@/pages/support";
import Settings from "@/pages/settings";
import PromptStudio from "@/pages/prompt-studio";
import SunoLanding from "@/pages/suno-landing";
import CanvasLanding from "@/pages/canvas-landing";
import LyricSyncPage from "@/pages/lyric-sync";
import { LYRICSYNC_PUBLIC } from "@/lib/featureFlags";
import {
  AiMusicVideoLanding, LyricVideoLanding, InstrumentalLanding, SunoToVideoLanding,
  PodcastToVideoLanding,
  HipHopMusicVideoLanding, EdmMusicVideoLanding, RockMusicVideoLanding,
  PopMusicVideoLanding, CountryMusicVideoLanding, LofiMusicVideoLanding,
  SlideshowMakerLanding, WeddingSlideshowLanding, CapcutAlternativeLanding,
} from "@/pages/use-case-landing";
import ForgotPassword from "@/pages/forgot-password";
import ResetPassword from "@/pages/reset-password";
import Redeem from "@/pages/redeem";
import Suite from "@/pages/suite";
import Comparison from "@/pages/comparison";
import Podcast from "@/pages/podcast";

import TutorialScriptToVideo from "@/pages/tutorial-script-to-video";
import WhatsNew from "@/pages/whats-new";
import { useAuth } from "@/hooks/useAuth";
import { RouteMetadata } from "@/components/RouteMetadata";
import { Loader2 } from "lucide-react";

import { CreationGuide } from "@/components/creation-guide/CreationGuide";

const queryClient = new QueryClient();

function AdminOnly({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return user?.isAdmin === true ? children : <NotFound />;
}

function AdminRoute() {
  return <AdminOnly><Admin /></AdminOnly>;
}

function AdminRunwayLipSyncRoute() {
  return <AdminOnly><AdminRunwayLipSync /></AdminOnly>;
}

function GenerateRoute() {
  const [, navigate] = useLocation();
  const destination = imageCreationRedirect(window.location.search);
  useEffect(() => {
    if (destination) navigate(destination, { replace: true });
  }, [destination, navigate]);
  // Do not mount Generate's handoff effects: they consume and clear query parameters.
  return destination ? null : <Generate />;
}

// Fires a pageview on every route change and records time-on-page. Rendered
// inside the router so it sees wouter's location.
function AnalyticsTracker() {
  const [location] = useLocation();
  useEffect(() => { startAnalytics(); }, []);
  useEffect(() => { trackPageview(location); }, [location]);
  return null;
}

function Router() {
  const [location] = useLocation();
  const isAuthPage = ["/login", "/register", "/signup", "/forgot-password", "/reset-password"].includes(location.replace(/\/$/, ""));
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
      <RouteMetadata />
      <ScrollToTop />
      <Navbar />
      {!isAuthPage && <CreationGuide />}
      <main id="main-content" tabIndex={-1} className="flex-1 flex flex-col outline-none">
        <Switch>
          <Route path="/" component={Home} />
          <Route path="/login" component={Login} />
          <Route path="/register" component={Register} />
          <Route path="/signup" component={Register} />
          <Route path="/forgot-password" component={ForgotPassword} />
          <Route path="/reset-password" component={ResetPassword} />
          <Route path="/generate" component={GenerateRoute} />
          <Route path="/images" component={CreateImages} />
          <Route path="/editor" component={Editor} />
          <Route path="/dashboard" component={Dashboard} />
          <Route path="/gallery" component={Gallery} />
          <Route path="/soundtracks" component={Soundtracks} />
          <Route path="/prompt-studio" component={PromptStudio} />
          {LYRICSYNC_PUBLIC && <Route path="/lyric-sync" component={LyricSyncPage} />}
          <Route path="/s/:token" component={SharedSoundtrack} />
          <Route path="/explore" component={Explore} />
          <Route path="/image/:id" component={PublicImageDetail} />
          <Route path="/jobs/:id" component={JobStatus} />
          <Route path="/pricing" component={Pricing} />
          <Route path="/redeem" component={Redeem} />
          <Route path="/admin" component={AdminRoute} />
          <Route path="/admin/runway-lipsync" component={AdminRunwayLipSyncRoute} />
          <Route path="/terms" component={Terms} />
          <Route path="/dmca" component={Dmca} />
          <Route path="/privacy" component={Privacy} />
          <Route path="/support" component={Support} />
          <Route path="/settings" component={Settings} />
          <Route path="/suite" component={Suite} />
          <Route path="/compare" component={Comparison} />
          <Route path="/podcast" component={Podcast} />
          <Route path="/podcast/:id" component={Podcast} />
          <Route path="/suno" component={SunoLanding} />
          <Route path="/spotify-canvas" component={CanvasLanding} />
          <Route path="/ai-music-video-generator" component={AiMusicVideoLanding} />
          <Route path="/ai-lyric-video" component={LyricVideoLanding} />
          <Route path="/instrumental-generator" component={InstrumentalLanding} />
          <Route path="/suno-to-video" component={SunoToVideoLanding} />
          <Route path="/tutorial/script-to-video" component={TutorialScriptToVideo} />
          <Route path="/whats-new" component={WhatsNew} />
          <Route path="/podcast-to-video" component={PodcastToVideoLanding} />
          <Route path="/hip-hop-music-video-generator" component={HipHopMusicVideoLanding} />
          <Route path="/edm-music-video-generator" component={EdmMusicVideoLanding} />
          <Route path="/rock-music-video-generator" component={RockMusicVideoLanding} />
          <Route path="/pop-music-video-generator" component={PopMusicVideoLanding} />
          <Route path="/country-music-video-generator" component={CountryMusicVideoLanding} />
          <Route path="/lofi-music-video-generator" component={LofiMusicVideoLanding} />
          <Route path="/slideshow-maker" component={SlideshowMakerLanding} />
          <Route path="/wedding-slideshow-maker" component={WeddingSlideshowLanding} />
          <Route path="/capcut-alternative" component={CapcutAlternativeLanding} />
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
