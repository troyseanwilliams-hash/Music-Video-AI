import LyricSyncStudio from "@/components/admin/LyricSyncStudio";
import { useSEO } from "@/hooks/useSEO";

/**
 * Public Lyric Sync page. Mounted only when VITE_LYRICSYNC_PUBLIC === "true"
 * (see App.tsx + lib/featureFlags.ts). Lip sync is offered as an optional
 * premium setting inside the studio, not a separate mode.
 */
export default function LyricSyncPage() {
  useSEO({
    title: "Lyric Sync — Karaoke Music Videos",
    description:
      "Turn your song and lyrics into a word-synced karaoke video. Optionally add a lip-synced performer. Fast, in your browser.",
    canonical: "/lyric-sync",
  });

  return (
    <div className="container mx-auto px-4 py-6 sm:py-10 max-w-6xl">
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Lyric Sync</h1>
        <p className="text-sm text-muted-foreground">
          Sync your lyrics to the vocal for a karaoke-style video. Add a lip-synced performer as an optional premium add-on.
        </p>
      </div>
      <LyricSyncStudio variant="public" />
    </div>
  );
}
