import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
import Explore from "@/pages/explore";
import JobStatus from "@/pages/job-status";
import Pricing from "@/pages/pricing";
import Admin from "@/pages/admin";
import Terms from "@/pages/terms";
import Dmca from "@/pages/dmca";
import Support from "@/pages/support";
import SunoLanding from "@/pages/suno-landing";
import CanvasLanding from "@/pages/canvas-landing";
import ForgotPassword from "@/pages/forgot-password";
import ResetPassword from "@/pages/reset-password";

const queryClient = new QueryClient();

function Router() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col font-sans">
      <Navbar />
      <main className="flex-1 flex flex-col">
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
          <Route path="/explore" component={Explore} />
          <Route path="/jobs/:id" component={JobStatus} />
          <Route path="/pricing" component={Pricing} />
          <Route path="/admin" component={Admin} />
          <Route path="/terms" component={Terms} />
          <Route path="/dmca" component={Dmca} />
          <Route path="/support" component={Support} />
          <Route path="/suno" component={SunoLanding} />
          <Route path="/spotify-canvas" component={CanvasLanding} />
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
