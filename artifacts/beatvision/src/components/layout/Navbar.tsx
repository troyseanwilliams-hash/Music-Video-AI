import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useAuth } from "@/hooks/useAuth";
import { useGetDashboardStats, getGetDashboardStatsQueryKey } from "@workspace/api-client-react";
import {
  Video, LayoutDashboard, Wand2, LogOut, Loader2, ShieldCheck,
  MessageSquare, Menu, X, Film, CreditCard, Compass, Music2, Settings, Sparkles, Gift,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useState } from "react";

export function Navbar() {
  const [location] = useLocation();
  const { user, isAuthenticated, logout, isLoading: isAuthLoading } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const { data: stats } = useGetDashboardStats({
    query: {
      queryKey: getGetDashboardStatsQueryKey(),
      enabled: isAuthenticated,
      refetchInterval: 15000, // keep the "processing" pill fresh across pages
    }
  });

  const processingCount = ((stats as unknown as { activeJobs?: unknown[] })?.activeJobs?.length) ?? 0;

  const navLinks = [
    ...(isAuthenticated ? [
      { href: "/generate", label: "Generate", icon: Wand2 },
      { href: "/editor", label: "Remix Lab", icon: Video },
      { href: "/prompt-studio", label: "Prompt Studio", icon: Sparkles },
      { href: "/soundtracks", label: "Soundtracks", icon: Music2 },
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/gallery", label: "Gallery", icon: Film },
    ] : []),
    { href: "/explore", label: "Explore", icon: Compass },
    { href: "/pricing", label: "Pricing", icon: CreditCard },
  ];

  return (
    <>
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

            {/* Driven by navLinks so the top nav + account dropdown stay in sync. */}
            <nav className="hidden md:flex items-center gap-6">
              {navLinks.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className={`text-sm font-medium transition-colors hover:text-primary ${location === l.href ? 'text-foreground' : 'text-muted-foreground'}`}
                >
                  {l.label}
                </Link>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-3">
            {isAuthenticated && processingCount > 0 && (
              <Link
                href="/dashboard"
                className="flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-sm font-medium text-primary transition-opacity hover:opacity-80"
                title={`${processingCount} video${processingCount === 1 ? "" : "s"} processing`}
              >
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span className="hidden sm:inline">{processingCount} processing</span>
                <span className="sm:hidden">{processingCount}</span>
              </Link>
            )}
            <ThemeToggle />
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
              <>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" className="relative h-9 w-9 rounded-full" aria-label="Account menu">
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
                    {/* Mirror the main menu exactly (same navLinks, same order). */}
                    {navLinks.map((l) => (
                      <DropdownMenuItem key={l.href} asChild>
                        <Link href={l.href} className="cursor-pointer flex items-center">
                          <l.icon className="mr-2 h-4 w-4" />
                          <span>{l.label}</span>
                        </Link>
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild>
                      <Link href="/redeem" className="cursor-pointer flex items-center">
                        <Gift className="mr-2 h-4 w-4" />
                        <span>Redeem code</span>
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link href="/settings" className="cursor-pointer flex items-center">
                        <Settings className="mr-2 h-4 w-4" />
                        <span>Settings</span>
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link href="/support" className="cursor-pointer flex items-center">
                        <MessageSquare className="mr-2 h-4 w-4" />
                        <span>Support</span>
                      </Link>
                    </DropdownMenuItem>
                    {user.isAdmin && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem asChild>
                          <Link href="/admin" className="cursor-pointer flex items-center">
                            <ShieldCheck className="mr-2 h-4 w-4 text-primary" />
                            <span>Admin</span>
                          </Link>
                        </DropdownMenuItem>
                      </>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => logout()} className="text-destructive focus:text-destructive cursor-pointer">
                      <LogOut className="mr-2 h-4 w-4" />
                      <span>Log out</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                {/* Mobile hamburger — hidden on md+ */}
                <button
                  className="md:hidden flex items-center justify-center h-10 w-10 rounded-lg border border-border/50 bg-secondary/40 hover:bg-secondary/70 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  onClick={() => setMobileMenuOpen((v) => !v)}
                  aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
                  aria-expanded={mobileMenuOpen}
                  aria-controls="mobile-nav-panel"
                >
                  {mobileMenuOpen
                    ? <X className="h-5 w-5" aria-hidden="true" />
                    : <Menu className="h-5 w-5" aria-hidden="true" />}
                </button>
              </>
            ) : (
              <div className="flex items-center gap-3">
                <Link href="/login" className="text-sm font-medium text-muted-foreground hover:text-foreground hidden sm:block">
                  Sign in
                </Link>
                <Link href="/login">
                  <Button className="bg-gradient-electric text-white shadow-glow hover:opacity-90 transition-opacity border-0">
                    Get Started
                  </Button>
                </Link>
                {/* Mobile hamburger for logged-out visitors — reach Explore/Pricing */}
                <button
                  className="md:hidden flex items-center justify-center h-10 w-10 rounded-lg border border-border/50 bg-secondary/40 hover:bg-secondary/70 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  onClick={() => setMobileMenuOpen((v) => !v)}
                  aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
                  aria-expanded={mobileMenuOpen}
                  aria-controls="mobile-nav-panel"
                >
                  {mobileMenuOpen
                    ? <X className="h-5 w-5" aria-hidden="true" />
                    : <Menu className="h-5 w-5" aria-hidden="true" />}
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Mobile slide-down nav panel */}
      {mobileMenuOpen && (
        <div id="mobile-nav-panel" className="md:hidden fixed top-16 inset-x-0 z-40 border-b border-border/50 bg-background/95 backdrop-blur shadow-lg">
          <nav aria-label="Mobile" className="container mx-auto px-4 py-3 flex flex-col gap-1">
            {navLinks.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                onClick={() => setMobileMenuOpen(false)}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  location === href
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {label}
              </Link>
            ))}

            {/* Credits summary on mobile */}
            {isAuthenticated && stats && (
              <div className="mt-2 pt-2 border-t border-border/40 flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
                <Wand2 className="h-4 w-4 text-primary" />
                <span><strong className="text-foreground">{stats.creditsRemaining}</strong> credits remaining</span>
              </div>
            )}

            {/* Sign-in prompt for logged-out visitors */}
            {!isAuthenticated && (
              <Link
                href="/login"
                onClick={() => setMobileMenuOpen(false)}
                className="mt-2 pt-2 border-t border-border/40 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
              >
                <LogOut className="h-4 w-4 shrink-0 rotate-180" aria-hidden="true" />
                Sign in
              </Link>
            )}
          </nav>
        </div>
      )}
    </>
  );
}
