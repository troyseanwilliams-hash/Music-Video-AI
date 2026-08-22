import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Loader2, Share2, Download, Smartphone, Disc3, Coins, Mic2, Package, Film,
  Image as ImageIcon, Check, Sparkles,
} from "lucide-react";
import {
  TEASER_PACK_COST,
  CANVAS_EXPORT_COST,
  LYRIC_OVERLAY_COST,
  RELEASE_KIT_COST,
} from "@/lib/creditPricing";
import { track } from "@/lib/analytics";
import { MAX_LYRICS_LENGTH } from "@/lib/lyricLimits";

interface TeaserItem {
  index: number;
  url: string;
  startTime: number;
  durationSec: number;
  kind?: "teaser" | "canvas";
}

interface KitExtras {
  videoUrl?: string | null;
  thumbnailUrl?: string | null;
  lyricVideo?: { videoId: string; url: string } | null;
}

/**
 * Social exports for a finished video. Leads with the one-click Release Kit
 * (full video + 3 TikTok/Shorts teasers + Spotify Canvas loop + thumbnail, plus
 * an optional karaoke-lyrics version) at a bundle discount, with the individual
 * exports available underneath.
 */
export default function SocialExportsPanel({ videoId }: { videoId: string }) {
  const [items, setItems] = useState<TeaserItem[]>([]);
  const [busy, setBusy] = useState<"teaser" | "canvas" | "lyrics" | "kit" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const [lyricsText, setLyricsText] = useState("");
  const [lyricResult, setLyricResult] = useState<{ videoId: string; url: string } | null>(null);
  const [sharedUrl, setSharedUrl] = useState<string | null>(null);

  // Release Kit state
  const [kitLyricsOpen, setKitLyricsOpen] = useState(false);
  const [kitLyrics, setKitLyrics] = useState("");
  // One rights attestation shared by both lyric-burn paths (kit + standalone);
  // the server rejects lyric burns without it.
  const [rightsAcknowledged, setRightsAcknowledged] = useState(false);
  // Auto-sync: AI listens to this video's track and returns word-timed lyrics.
  const [syncing, setSyncing] = useState<"lyrics" | "kit" | null>(null);

  async function autoSync(target: "lyrics" | "kit") {
    if (!rightsAcknowledged || syncing) return;
    setSyncing(target);
    setError(null);
    try {
      const current = (target === "kit" ? kitLyrics : lyricsText).trim();
      const r = await fetch(`/api/lyrics/align`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId, lyricsText: current || undefined, acceptCopyright: true }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error ?? "Auto-sync failed");
      if (typeof data.lrc === "string" && data.lrc.trim()) {
        if (target === "kit") setKitLyrics(data.lrc);
        else setLyricsText(data.lrc);
      } else {
        throw new Error("Auto-sync couldn't detect vocals in this track.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Auto-sync failed");
    } finally {
      setSyncing(null);
    }
  }
  const [kitExtras, setKitExtras] = useState<KitExtras | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/videos/${videoId}/teasers`, { credentials: "include" });
        if (r.ok && !cancelled) {
          const data = await r.json();
          setItems((data.teasers as TeaserItem[]) ?? []);
        }
      } catch {
        /* panel just starts empty */
      }
    })();
    return () => { cancelled = true; };
  }, [videoId]);

  async function generate(kind: "teaser" | "canvas") {
    setBusy(kind);
    setError(null);
    try {
      const r = await fetch(`/api/videos/${videoId}/${kind === "teaser" ? "teasers" : "canvas"}`, {
        method: "POST",
        credentials: "include",
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Export failed");
      setItems((prev) => [...prev, ...((data.teasers as TeaserItem[]) ?? [])]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setBusy(null);
    }
  }

  async function runReleaseKit() {
    setBusy("kit");
    setError(null);
    try {
      const body = kitLyrics.trim()
        ? { lyricsText: kitLyrics.trim(), acceptCopyright: rightsAcknowledged }
        : {};
      const r = await fetch(`/api/videos/${videoId}/release-kit`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Release Kit failed");
      setItems((data.teasers as TeaserItem[]) ?? []);
      setKitExtras({
        videoUrl: data.videoUrl ?? null,
        thumbnailUrl: data.thumbnailUrl ?? null,
        lyricVideo: data.lyricVideo ?? null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Release Kit failed");
    } finally {
      setBusy(null);
    }
  }

  function triggerDownload(url: string, filename: string) {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // One-tap share. On mobile, tries to hand the actual video file to the OS share
  // sheet (so it posts straight to TikTok/Reels/Shorts); otherwise shares/copies
  // the link. Every shared clip carries the watermark, so it doubles as an ad.
  const SHARE_TEXT = "Made with AIBeatSync 🎬 — turn your music into an AI video at https://aibeatsync.com";
  async function shareClip(url: string, filename: string) {
    track("share_clip", { kind: filename.startsWith("canvas") ? "canvas" : filename.startsWith("short") ? "short" : "video" });
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const file = new File([blob], filename, { type: blob.type || "video/mp4" });
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (nav.canShare?.({ files: [file] })) {
        await nav.share!({ files: [file], title: "Made with AIBeatSync", text: SHARE_TEXT });
        return;
      }
    } catch {
      /* CORS or cancel — fall through to link share */
    }
    try {
      if (navigator.share) {
        await navigator.share({ title: "Made with AIBeatSync", text: SHARE_TEXT, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setSharedUrl(url);
      setTimeout(() => setSharedUrl(null), 1500);
    } catch {
      /* user cancelled or clipboard blocked */
    }
  }

  function downloadAll() {
    const files: { url: string; name: string }[] = [];
    if (kitExtras?.videoUrl) files.push({ url: kitExtras.videoUrl, name: "video.mp4" });
    if (kitExtras?.thumbnailUrl) files.push({ url: kitExtras.thumbnailUrl, name: "thumbnail.jpg" });
    teasers.forEach((t, i) => files.push({ url: t.url, name: `short-${i + 1}.mp4` }));
    canvases.forEach((c) => files.push({ url: c.url, name: "canvas.mp4" }));
    if (kitExtras?.lyricVideo) files.push({ url: kitExtras.lyricVideo.url, name: "lyrics.mp4" });
    // Stagger clicks so the browser doesn't drop concurrent downloads.
    files.forEach((f, i) => setTimeout(() => triggerDownload(f.url, f.name), i * 400));
  }

  async function burnLyrics() {
    if (!lyricsText.trim()) return;
    setBusy("lyrics");
    setError(null);
    try {
      const r = await fetch(`/api/videos/${videoId}/lyrics`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lyricsText: lyricsText.trim(), acceptCopyright: rightsAcknowledged }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Lyric burn failed");
      setLyricResult({ videoId: data.videoId, url: data.url });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lyric burn failed");
    } finally {
      setBusy(null);
    }
  }

  const teasers = items.filter((i) => (i.kind ?? "teaser") === "teaser");
  const canvases = items.filter((i) => i.kind === "canvas");
  const kitDone = teasers.length > 0 && canvases.length > 0;
  const kitCost = RELEASE_KIT_COST + (kitLyrics.trim() ? LYRIC_OVERLAY_COST : 0);

  return (
    <Card data-testid="card-social-exports">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Share2 className="h-4 w-4 text-primary" /> Share &amp; export
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* ── Release Kit (hero) ─────────────────────────────────────────── */}
        <div className="rounded-xl border border-primary/30 bg-gradient-to-br from-primary/10 to-transparent p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 font-semibold">
              <Package className="h-4 w-4 text-primary" /> Release Kit
            </div>
            <span className="rounded-full bg-primary/15 border border-primary/25 px-2 py-0.5 text-[11px] font-medium text-primary">
              Save 10 credits
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            Everything to drop this track in one click — the full video, 3 vertical TikTok/Shorts
            cuts, a Spotify Canvas loop, and the thumbnail.
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><Film className="h-3.5 w-3.5" /> Full video</span>
            <span className="flex items-center gap-1"><Smartphone className="h-3.5 w-3.5" /> 3 Shorts</span>
            <span className="flex items-center gap-1"><Disc3 className="h-3.5 w-3.5" /> Canvas loop</span>
            <span className="flex items-center gap-1"><ImageIcon className="h-3.5 w-3.5" /> Thumbnail</span>
            {kitLyrics.trim() && <span className="flex items-center gap-1"><Mic2 className="h-3.5 w-3.5" /> Lyrics</span>}
          </div>

          {!kitLyricsOpen ? (
            <button
              type="button"
              onClick={() => setKitLyricsOpen(true)}
              className="text-xs text-primary hover:underline"
              data-testid="button-kit-add-lyrics"
            >
              + Add a karaoke-lyrics version (+{LYRIC_OVERLAY_COST} cr)
            </button>
          ) : (
            <>
              <Textarea
                placeholder="Paste lyrics to also get a karaoke version (plain text or .lrc). Leave blank to skip."
                className="min-h-[70px] resize-none text-sm"
                value={kitLyrics}
                onChange={(e) => setKitLyrics(e.target.value)}
                maxLength={MAX_LYRICS_LENGTH}
                data-testid="textarea-kit-lyrics"
              />
              <label className="flex items-start gap-2.5 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={rightsAcknowledged}
                  onChange={(e) => setRightsAcknowledged(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-primary cursor-pointer"
                />
                <span className="text-xs text-muted-foreground leading-relaxed group-hover:text-foreground/80 transition-colors">
                  I confirm I have the rights to this song <em>and</em> its lyrics (owned, licensed, or created here). Lyrics are copyrighted separately from the recording.
                </span>
              </label>
              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy !== null || syncing !== null || !rightsAcknowledged}
                  onClick={() => autoSync("kit")}
                  data-testid="button-autosync-kit"
                >
                  {syncing === "kit"
                    ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Listening…</>
                    : <><Sparkles className="mr-1.5 h-3.5 w-3.5" /> Auto-sync to vocals (2 cr)</>}
                </Button>
              </div>
            </>
          )}

          {!kitDone ? (
            <Button
              disabled={busy !== null || (!!kitLyrics.trim() && !rightsAcknowledged)}
              onClick={runReleaseKit}
              className="w-full bg-gradient-electric text-white border-0"
              data-testid="button-release-kit"
            >
              {busy === "kit"
                ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Building your kit…</>
                : <><Package className="mr-2 h-4 w-4" /> Generate Release Kit</>}
              <span className="ml-2 flex items-center gap-1 text-xs opacity-90">
                <Coins className="h-3 w-3" />{kitCost}
              </span>
            </Button>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex items-center gap-1.5 text-sm text-green-500 font-medium">
                <Check className="h-4 w-4" /> Kit ready
              </span>
              <Button size="sm" onClick={downloadAll} data-testid="button-download-all">
                <Download className="mr-1.5 h-3.5 w-3.5" /> Download all
              </Button>
            </div>
          )}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {/* Full video + thumbnail + lyric video (from the kit) */}
        {kitExtras && (kitExtras.videoUrl || kitExtras.thumbnailUrl || kitExtras.lyricVideo) && (
          <div className="flex flex-wrap gap-2">
            {kitExtras.videoUrl && (
              <Button size="sm" variant="outline" onClick={() => triggerDownload(kitExtras.videoUrl!, "video.mp4")}>
                <Film className="mr-1.5 h-3.5 w-3.5" /> Video
              </Button>
            )}
            {kitExtras.videoUrl && (
              <Button size="sm" className="bg-gradient-electric text-white border-0" onClick={() => shareClip(kitExtras.videoUrl!, "video.mp4")}>
                {sharedUrl === kitExtras.videoUrl ? <><Check className="mr-1.5 h-3.5 w-3.5" /> Link copied</> : <><Share2 className="mr-1.5 h-3.5 w-3.5" /> Share</>}
              </Button>
            )}
            {kitExtras.thumbnailUrl && (
              <Button size="sm" variant="outline" onClick={() => triggerDownload(kitExtras.thumbnailUrl!, "thumbnail.jpg")}>
                <ImageIcon className="mr-1.5 h-3.5 w-3.5" /> Thumbnail
              </Button>
            )}
            {kitExtras.lyricVideo && (
              <Button size="sm" variant="outline" onClick={() => triggerDownload(kitExtras.lyricVideo!.url, "lyrics.mp4")}>
                <Mic2 className="mr-1.5 h-3.5 w-3.5" /> Lyrics video
              </Button>
            )}
          </div>
        )}

        {/* Shorts + Canvas grid */}
        {items.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {items.map((t) => (
              <div key={t.index} className="space-y-2">
                <video
                  src={t.url}
                  controls
                  playsInline
                  className="w-full aspect-[9/16] rounded-lg border border-border bg-black object-cover"
                />
                <div className="flex gap-1">
                  <a href={t.url} download={`${t.kind === "canvas" ? "canvas" : "teaser"}-${t.index + 1}.mp4`} className="flex-1">
                    <Button size="sm" variant="ghost" className="w-full text-xs">
                      <Download className="mr-1.5 h-3.5 w-3.5" />
                      {t.kind === "canvas" ? "Canvas" : `Short ${t.index + 1}`}
                    </Button>
                  </a>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-xs shrink-0"
                    aria-label="Share clip"
                    onClick={() => shareClip(t.url, `${t.kind === "canvas" ? "canvas" : "short"}-${t.index + 1}.mp4`)}
                  >
                    {sharedUrl === t.url ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Share2 className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {canvases.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Upload your Canvas loop in Spotify for Artists → your track → Canvas.
          </p>
        )}

        {/* ── Individual exports ─────────────────────────────────────────── */}
        <div className="pt-2 border-t border-border/50 space-y-3">
          <p className="text-xs font-medium text-muted-foreground">Or export individually</p>
          <div className="flex flex-wrap gap-3">
            {teasers.length === 0 && (
              <Button
                variant="outline"
                disabled={busy !== null}
                onClick={() => generate("teaser")}
                data-testid="button-make-teasers"
              >
                {busy === "teaser"
                  ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  : <Smartphone className="mr-2 h-4 w-4" />}
                3 TikTok / Shorts teasers
                <span className="ml-2 flex items-center gap-1 text-xs text-accent">
                  <Coins className="h-3 w-3" />{TEASER_PACK_COST}
                </span>
              </Button>
            )}
            {canvases.length === 0 && (
              <Button
                variant="outline"
                disabled={busy !== null}
                onClick={() => generate("canvas")}
                data-testid="button-make-canvas"
              >
                {busy === "canvas"
                  ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  : <Disc3 className="mr-2 h-4 w-4" />}
                Spotify Canvas loop
                <span className="ml-2 flex items-center gap-1 text-xs text-accent">
                  <Coins className="h-3 w-3" />{CANVAS_EXPORT_COST}
                </span>
              </Button>
            )}
            {!lyricResult && (
              <Button
                variant="outline"
                disabled={busy !== null}
                onClick={() => setLyricsOpen((v) => !v)}
                data-testid="button-open-lyric-burn"
              >
                <Mic2 className="mr-2 h-4 w-4" />
                Add karaoke lyrics
                <span className="ml-2 flex items-center gap-1 text-xs text-accent">
                  <Coins className="h-3 w-3" />{LYRIC_OVERLAY_COST}
                </span>
              </Button>
            )}
          </div>

          {lyricsOpen && !lyricResult && (
            <div className="space-y-2">
              <Textarea
                placeholder="Paste lyrics — plain text, or .lrc with [mm:ss] timestamps (word-level <mm:ss> tags supported) for exact sync..."
                className="min-h-[100px] resize-none text-sm"
                value={lyricsText}
                onChange={(e) => setLyricsText(e.target.value)}
                maxLength={MAX_LYRICS_LENGTH}
                data-testid="textarea-lyric-burn"
              />
              <label className="flex items-start gap-2.5 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={rightsAcknowledged}
                  onChange={(e) => setRightsAcknowledged(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-primary cursor-pointer"
                />
                <span className="text-xs text-muted-foreground leading-relaxed group-hover:text-foreground/80 transition-colors">
                  I confirm I have the rights to this song <em>and</em> its lyrics (owned, licensed, or created here). Lyrics are copyrighted separately from the recording.
                </span>
              </label>
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  {/\[\d{1,2}:\d{2}/.test(lyricsText)
                    ? "LRC timestamps detected — exact sync"
                    : lyricsText.trim()
                      ? "No timestamps — Auto-sync times each word (2 cr), or lines spread evenly"
                      : "Paste lyrics, or hit Auto-sync to transcribe them from the track (2 cr)."}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy !== null || syncing !== null || !rightsAcknowledged}
                  onClick={() => autoSync("lyrics")}
                  data-testid="button-autosync-lyrics"
                >
                  {syncing === "lyrics"
                    ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Listening…</>
                    : <><Sparkles className="mr-1.5 h-3.5 w-3.5" /> Auto-sync to vocals</>}
                </Button>
                <Button
                  size="sm"
                  disabled={busy !== null || !lyricsText.trim() || !rightsAcknowledged}
                  onClick={burnLyrics}
                  data-testid="button-burn-lyrics"
                >
                  {busy === "lyrics"
                    ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Burning…</>
                    : "Burn lyrics"}
                </Button>
              </div>
            </div>
          )}

          {lyricResult && (
            <div className="space-y-2">
              <video
                src={lyricResult.url}
                controls
                playsInline
                className="w-full max-w-md rounded-lg border border-border bg-black"
              />
              <p className="text-xs text-muted-foreground">
                Karaoke version saved to your library alongside the original.
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
