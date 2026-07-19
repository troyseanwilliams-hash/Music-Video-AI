import { Link } from "wouter";

export function Footer() {
  return (
    <footer className="w-full border-t border-border/30 bg-background/60 py-6 mt-auto">
      <div className="container mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-muted-foreground">
        <p>© {new Date().getFullYear()} AI Beat Sync. All rights reserved.</p>
        <nav className="flex items-center gap-5">
          <Link href="/suno" className="hover:text-foreground transition-colors">
            Suno to Video
          </Link>
          <Link href="/spotify-canvas" className="hover:text-foreground transition-colors">
            Canvas Maker
          </Link>
          <Link href="/terms" className="hover:text-foreground transition-colors">
            Terms of Service
          </Link>
          <Link href="/dmca" className="hover:text-foreground transition-colors">
            DMCA / Copyright
          </Link>
          <Link href="/support" className="hover:text-foreground transition-colors">
            Support
          </Link>
          <a href="mailto:legal@aibeatsync.com" className="hover:text-foreground transition-colors">
            Contact
          </a>
        </nav>
      </div>
    </footer>
  );
}
