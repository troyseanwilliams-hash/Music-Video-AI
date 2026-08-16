// Client feature flags. Flip via Vite env (VITE_*) — no code deploy needed, and
// setting it back to false is an instant kill switch.

// AILyricSync (Lyric Sync) public rollout. Default OFF = admin-only.
// When true, the public /lyric-sync route + its entry points mount.
export const LYRICSYNC_PUBLIC = import.meta.env.VITE_LYRICSYNC_PUBLIC === "true";
