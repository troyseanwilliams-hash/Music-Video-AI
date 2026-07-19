import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Share2, Download, Smartphone, Disc3, Coins } from "lucide-react";
import {
  TEASER_PACK_COST,
  CANVAS_EXPORT_COST,
} from "@/lib/creditPricing";

interface TeaserItem {
  index: number;
  url: string;
  startTime: number;
  durationSec: number;
  kind?: "teaser" | "canvas";
}

/**
 * Social exports for a finished video: vertical TikTok/Shorts teaser cuts
 * (auto-picked at the most energetic moments) + a Spotify Canvas loop.
 */
export default function SocialExportsPanel({ videoId }: { videoId: string }) {
  const [items, setItems] = useState<TeaserItem[]>([]);
  const [busy, setBusy] = useState<"teaser" | "canvas" | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const teasers = items.filter((i) => (i.kind ?? "teaser") === "teaser");
  const canvases = items.filter((i) => i.kind === "canvas");

  return (
    <Card data-testid="card-social-exports">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Share2 className="h-4 w-4 text-primary" /> Social exports
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm text-muted-foreground">
          Cut from your finished video at its most energetic moments — sized and ready to post.
        </p>

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
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

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
      </CardContent>
    </Card>
  );
}
