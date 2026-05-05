import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useGetDashboardStats } from "@workspace/api-client-react";
import { Video, LayoutDashboard, Wand2, LogOut, Loader2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export function Navbar() {
  const [location] = useLocation();
  const { user, isAuthenticated, logout, isLoading: isAuthLoading } = useAuth();
  
  const { data: stats } = useGetDashboardStats({
    query: {
      enabled: isAuthenticated,
    }
  });

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/50 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-16 items-center justify-between mx-auto px-4">
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-2 transition-opacity hover:opacity-80">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-electric shadow-glow">
              <Video className="h-5 w-5 text-white" />
            </div>
            <span className="font-bold text-xl tracking-tight hidden sm:inline-block">
              AI Beat Sync
            </span>
          </Link>

          <nav className="hidden md:flex items-center gap-6">
            {isAuthenticated && (
              <>
                <Link 
                  href="/generate" 
                  className={`text-sm font-medium transition-colors hover:text-primary ${location === '/generate' ? 'text-foreground' : 'text-muted-foreground'}`}
                >
                  Generate
                </Link>
                <Link 
                  href="/dashboard" 
                  className={`text-sm font-medium transition-colors hover:text-primary ${location === '/dashboard' ? 'text-foreground' : 'text-muted-foreground'}`}
                >
                  Dashboard
                </Link>
                <Link 
                  href="/gallery" 
                  className={`text-sm font-medium transition-colors hover:text-primary ${location === '/gallery' ? 'text-foreground' : 'text-muted-foreground'}`}
                >
                  Gallery
                </Link>
              </>
            )}
            <Link 
              href="/pricing" 
              className={`text-sm font-medium transition-colors hover:text-primary ${location === '/pricing' ? 'text-foreground' : 'text-muted-foreground'}`}
            >
              Pricing
            </Link>
          </nav>
        </div>

        <div className="flex items-center gap-4">
          {isAuthenticated && stats && (
            <div
              className="hidden sm:flex items-center gap-2 rounded-full border border-border/50 bg-secondary/50 px-3 py-1 text-sm font-medium"
              title={`Plan: ${stats.subscriptionCredits} · Top-up: ${stats.topupCredits}`}
              data-testid="navbar-credits"
            >
              <Wand2 className="h-4 w-4 text-primary" />
              <span>{stats.creditsRemaining} Credits</span>
              {stats.topupCredits > 0 && (
                <span className="text-xs text-muted-foreground font-normal">
                  ({stats.subscriptionCredits} + {stats.topupCredits})
                </span>
              )}
            </div>
          )}

          {isAuthLoading ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : isAuthenticated && user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="relative h-9 w-9 rounded-full">
                  <Avatar className="h-9 w-9 border border-border/50">
                    <AvatarImage src={user.profileImageUrl || undefined} alt={user.firstName || 'User'} />
                    <AvatarFallback className="bg-primary/20 text-primary">
                      {user.firstName?.charAt(0) || user.email?.charAt(0) || 'U'}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56" align="end" forceMount>
                <div className="flex items-center justify-start gap-2 p-2">
                  <div className="flex flex-col space-y-1 leading-none">
                    {user.firstName && <p className="font-medium">{user.firstName} {user.lastName}</p>}
                    <p className="w-[200px] truncate text-sm text-muted-foreground">
                      {user.email}
                    </p>
                  </div>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/generate" className="cursor-pointer flex items-center">
                    <Wand2 className="mr-2 h-4 w-4" />
                    <span>Generate Video</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/dashboard" className="cursor-pointer flex items-center">
                    <LayoutDashboard className="mr-2 h-4 w-4" />
                    <span>Dashboard</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => logout()} className="text-destructive focus:text-destructive cursor-pointer">
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Log out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <div className="flex items-center gap-4">
              <Link href="/login" className="text-sm font-medium text-muted-foreground hover:text-foreground hidden sm:block">
                Sign in
              </Link>
              <Link href="/login">
                <Button className="bg-gradient-electric text-white shadow-glow hover:opacity-90 transition-opacity border-0">
                  Get Started
                </Button>
              </Link>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
