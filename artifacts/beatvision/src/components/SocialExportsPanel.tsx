import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Loader2, Share2, Download, Smartphone, Disc3, Coins, Mic2, Package, Film,
  Image as ImageIcon, Check,
} from "lucide-react";
import {
  TEASER_PACK_COST,
  CANVAS_EXPORT_COST,
  LYRIC_OVERLAY_COST,
  RELEASE_KIT_COST,
} from "@/lib/creditPricing";

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

  // Release Kit state
  const [kitLyricsOpen, setKitLyricsOpen] = useState(false);
  const [kitLyrics, setKitLyrics] = useState("");
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
      const body = kitLyrics.trim() ? { lyricsText: kitLyrics.trim() } : {};
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
        body: JSON.stringify({ lyricsText: lyricsText.trim() }),
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
            <Textarea
              placeholder="Paste lyrics to also get a karaoke version (plain text or .lrc). Leave blank to skip."
              className="min-h-[70px] resize-none text-sm"
              value={kitLyrics}
              onChange={(e) => setKitLyrics(e.target.value)}
              maxLength={5000}
              data-testid="textarea-kit-lyrics"
            />
          )}

          {!kitDone ? (
            <Button
              disabled={busy !== null}
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
                <a href={t.url} download={`${t.kind === "canvas" ? "canvas" : "teaser"}-${t.index + 1}.mp4`}>
                  <Button size="sm" variant="ghost" className="w-full text-xs">
                    <Download className="mr-1.5 h-3.5 w-3.5" />
                    {t.kind === "canvas" ? "Canvas" : `Teaser ${t.index + 1}`} · {t.durationSec}s
                  </Button>
                </a>
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
                maxLength={5000}
                data-testid="textarea-lyric-burn"
              />
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  {/\[\d{1,2}:\d{2}/.test(lyricsText)
                    ? "LRC timestamps detected — exact sync"
                    : lyricsText.trim()
                      ? "No timestamps — lines will be spread evenly"
                      : "Creates a new video in your library; the original is untouched."}
                </p>
                <Button
                  size="sm"
                  disabled={busy !== null || !lyricsText.trim()}
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
