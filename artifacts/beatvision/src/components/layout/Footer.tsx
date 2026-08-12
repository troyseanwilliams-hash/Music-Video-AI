import { Link } from "wouter";
import { Video } from "lucide-react";

const COLUMNS: { title: string; links: { label: string; href: string; external?: boolean }[] }[] = [
  {
    title: "Create",
    links: [
      { label: "Generate", href: "/generate" },
      { label: "Soundtracks", href: "/soundtracks" },
      { label: "Remix Lab", href: "/editor" },
      { label: "Explore", href: "/explore" },
    ],
  },
  {
    title: "Tools",
    links: [
      { label: "Suno to Video", href: "/suno" },
      { label: "Canvas Maker", href: "/spotify-canvas" },
      { label: "Pricing", href: "/pricing" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "Support", href: "/support" },
      { label: "Terms of Service", href: "/terms" },
      { label: "DMCA / Copyright", href: "/dmca" },
      { label: "Contact", href: "mailto:legal@aibeatsync.com", external: true },
      { label: "Also try AIPodSync", href: "https://aipodsync.com", external: true },
    ],
  },
];

export function Footer() {
  return (
    <footer className="mt-auto w-full border-t border-border/30 bg-background/60">
      <div className="container mx-auto px-4 py-10">
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          {/* Brand */}
          <div className="col-span-2 sm:col-span-1">
            <Link href="/" className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-electric shadow-glow">
                <Video className="h-5 w-5 text-white" />
              </div>
              <span className="text-lg font-bold tracking-tight">AI Beat Sync</span>
            </Link>
            <p className="mt-3 max-w-xs text-sm text-muted-foreground">
              Turn your music into beat-synced AI videos and royalty-free soundtracks.
            </p>
          </div>

          {COLUMNS.map((col) => (
            <div key={col.title}>
              <h4 className="mb-3 text-sm font-semibold">{col.title}</h4>
              <ul className="space-y-2 text-sm">
                {col.links.map((l) => (
                  <li key={l.label}>
                    {l.external ? (
                      <a href={l.href} className="text-muted-foreground transition-colors hover:text-foreground">
                        {l.label}
                      </a>
                    ) : (
                      <Link href={l.href} className="text-muted-foreground transition-colors hover:text-foreground">
                        {l.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-8 border-t border-border/30 pt-5 text-xs text-muted-foreground">
          © {new Date().getFullYear()} AI Beat Sync. All rights reserved.
        </div>
      </div>
    </footer>
  );
}
