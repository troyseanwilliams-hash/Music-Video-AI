import { Link } from "wouter";
import { Sparkles, LogOut, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import {
  getGetCurrentAuthUserQueryKey,
  logoutBrowserSession,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

export function Nav() {
  const { user, isAuthenticated, isLoading } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleLogout = async () => {
    try {
      await logoutBrowserSession();
      queryClient.setQueryData(getGetCurrentAuthUserQueryKey(), { user: null });
      window.location.assign(import.meta.env.BASE_URL);
    } catch {
      toast({ title: "Could not sign out", variant: "destructive" });
    }
  };

  return (
    <nav className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <Link href="/" className="flex items-center space-x-2 font-bold text-xl tracking-tight transition-opacity hover:opacity-80">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-electric text-white shadow-glow">
            <Sparkles className="h-4 w-4" />
          </div>
          <span className="bg-clip-text text-transparent bg-gradient-to-r from-primary to-accent">
            AISync Suite
          </span>
        </Link>
        <div className="flex items-center gap-4">
          <a href="https://aibeatsync.com" target="_blank" rel="noopener noreferrer" className="text-sm text-muted-foreground hover:text-foreground hidden sm:block">AIBeatSync</a>
          <a href="https://aipodsync.com" target="_blank" rel="noopener noreferrer" className="text-sm text-muted-foreground hover:text-foreground hidden sm:block">AIPodSync</a>
          <Link href="/pricing" className="text-sm text-muted-foreground hover:text-foreground hidden sm:block">Pricing</Link>
          
          <div className="h-4 w-[1px] bg-border hidden sm:block"></div>

          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : isAuthenticated ? (
            <div className="flex items-center gap-4">
              <span className="text-sm font-medium hidden sm:block">
                {user?.firstName || user?.email}
              </span>
              <Button variant="ghost" size="sm" onClick={handleLogout} className="text-muted-foreground hover:text-foreground">
                <LogOut className="h-4 w-4 mr-2" />
                Sign Out
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Link href="/login" className="text-sm font-medium hover:underline text-muted-foreground hover:text-foreground px-3 py-2">
                Log In
              </Link>
              <Link href="/register">
                <Button variant="electric" size="sm">Get Started</Button>
              </Link>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
