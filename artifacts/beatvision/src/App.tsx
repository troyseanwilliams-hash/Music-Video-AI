import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Navbar } from "@/components/layout/Navbar";
import NotFound from "@/pages/not-found";

import Home from "@/pages/home";
import Login from "@/pages/login";
import Register from "@/pages/register";
import Generate from "@/pages/generate";
import Dashboard from "@/pages/dashboard";
import Gallery from "@/pages/gallery";
import JobStatus from "@/pages/job-status";
import Pricing from "@/pages/pricing";
import Admin from "@/pages/admin";

const queryClient = new QueryClient();

function Router() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col font-sans">
      <Navbar />
      <main className="flex-1">
        <Switch>
          <Route path="/" component={Home} />
          <Route path="/login" component={Login} />
          <Route path="/register" component={Register} />
          <Route path="/generate" component={Generate} />
          <Route path="/dashboard" component={Dashboard} />
          <Route path="/gallery" component={Gallery} />
          <Route path="/jobs/:id" component={JobStatus} />
          <Route path="/pricing" component={Pricing} />
          <Route path="/admin" component={Admin} />
          <Route component={NotFound} />
        </Switch>
      </main>
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
