import { Link } from "wouter";
import { Video } from "lucide-react";

const COLUMNS: { title: string; links: { label: string; href: string; external?: boolean }[] }[] = [
  {
    title: "Create",
    links: [
      { label: "Generate", href: "/generate" },
      { label: "Make Music", href: "/soundtracks" },
      { label: "Remix Lab", href: "/editor" },
      { label: "Explore", href: "/explore" },
      { label: "Script to Video Tutorial", href: "/tutorial/script-to-video" },
    ],
  },
  {
    title: "Tools",
    links: [
      { label: "Suno to Video", href: "/suno" },
      { label: "Canvas Maker", href: "/spotify-canvas" },
      { label: "Why AIBeatSync?", href: "/compare" },
      { label: "Pricing", href: "/pricing" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "Support", href: "/support" },
      { label: "Terms of Service", href: "/terms" },
      { label: "Privacy Policy", href: "/privacy" },
      { label: "DMCA / Copyright", href: "/dmca" },
      { label: "Contact", href: "mailto:legal@aibeatsync.com", external: true },
      { label: "AISync Suite", href: "https://aisyncsuite.com", external: true },
      { label: "Narrate Your Videos", href: "https://aipodsync.com", external: true },
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
              <span className="text-lg font-bold tracking-tight">AIBeatSync</span>
            </Link>
            <p className="mt-3 max-w-xs text-sm text-muted-foreground">
              Create original songs and audio, then turn them into beat-synced AI videos—or use the music on its own.
            </p>
          </div>

          {COLUMNS.map((col) => (
            <div key={col.title} className="min-w-0">
              <h4 className="mb-3 text-sm font-semibold">{col.title}</h4>
              <ul className="space-y-2 text-sm">
                {col.links.map((l) => (
                  <li key={l.label}>
                    {l.external ? (
                      <a href={l.href} className="inline-flex min-h-10 items-center break-words py-1 text-muted-foreground transition-colors hover:text-foreground">
                        {l.label}
                      </a>
                    ) : (
                      <Link href={l.href} className="inline-flex min-h-10 items-center break-words py-1 text-muted-foreground transition-colors hover:text-foreground">
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
          © {new Date().getFullYear()} AIBeatSync. All rights reserved.
        </div>
      </div>
    </footer>
  );
}
