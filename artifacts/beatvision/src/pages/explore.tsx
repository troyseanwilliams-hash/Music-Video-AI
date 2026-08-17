import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { useSEO } from "@/hooks/useSEO";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Heart, Play, Loader2, Globe, EyeOff, Music2, Download, Scissors, Video } from "lucide-react";

interface PublicSoundtrack {
  id: string;
  title: string | null;
  prompt: string | null;
  creatorName: string | null;
  createdAt: string;
  objectPath: string;
  url: string;
  likeCount: number;
  liked: boolean;
}

interface GalleryVideo {
  id: string;
  videoObjectPath: string;
  thumbnailObjectPath: string | null;
  title: string | null;
  durationSeconds: number | null;
  style: string | null;
  likeCount: number;
  liked: boolean;
  creatorName: string | null;
  createdAt: string;
}

const PAGE_SIZE = 24;

function VideoCard({
  video,
  isAuthed,
  isAdmin,
  onLikeToggle,
  onUnpublish,
  onOpen,
}: {
  video: GalleryVideo;
  isAuthed: boolean;
  isAdmin: boolean;
  onLikeToggle: (v: GalleryVideo) => void;
  onUnpublish: (v: GalleryVideo) => void;
  onOpen: (v: GalleryVideo) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hovering, setHovering] = useState(false);
  const initial = (video.creatorName || "A").trim().charAt(0).toUpperCase();

  return (
    <div className="group mb-4 break-inside-avoid overflow-hidden rounded-xl border border-card-border bg-card shadow-lg transition-all hover:border-primary/50">
      <div className="relative">
      <div
        className="relative aspect-video cursor-pointer bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        role="button"
        tabIndex={0}
        aria-label={`Play ${video.title || "video"} with sound`}
        onClick={() => onOpen(video)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpen(video);
          }
        }}
        onMouseEnter={() => {
          setHovering(true);
          videoRef.current?.play().catch(() => {});
        }}
        onMouseLeave={() => {
          setHovering(false);
          const el = videoRef.current;
          if (el) {
            el.pause();
            el.currentTime = 0;
          }
        }}
      >
        {video.thumbnailObjectPath && (
          <img
            src={`/api/storage${video.thumbnailObjectPath}`}
            alt={video.title || "AI music video"}
            loading="lazy"
            className={`absolute inset-0 h-full w-full object-cover transition-opacity ${hovering ? "opacity-0" : "opacity-100"}`}
          />
        )}
        <video
          ref={videoRef}
          src={`/api/storage${video.videoObjectPath}`}
          muted
          loop
          playsInline
          preload="none"
          className={`absolute inset-0 h-full w-full object-cover transition-opacity ${hovering ? "opacity-100" : "opacity-0"}`}
        />
        {!hovering && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-black/40 backdrop-blur-sm transition-transform group-hover:scale-110">
              <Play className="ml-0.5 h-5 w-5 text-white" />
            </div>
          </div>
        )}
      </div>
      {/* Sibling of the card play button so interactive controls aren't nested. */}
      {isAdmin && (
        <button
          title="Unpublish"
          onClick={() => onUnpublish(video)}
          className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white hover:bg-destructive"
        >
          <EyeOff className="h-3.5 w-3.5" />
        </button>
      )}
      </div>

      <div className="flex items-center justify-between gap-2 p-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-medium text-primary">
            {initial}
          </div>
          <span className="truncate text-sm font-medium" title={video.title || "Untitled"}>
            {video.title || "Untitled"}
          </span>
        </div>
        <button
          onClick={() => onLikeToggle(video)}
          className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-sm transition-colors ${
            video.liked ? "text-primary" : "text-muted-foreground hover:text-foreground"
          }`}
          title={isAuthed ? (video.liked ? "Unlike" : "Like") : "Sign in to like"}
        >
          <Heart className={`h-4 w-4 ${video.liked ? "fill-current" : ""}`} />
          <span className="tabular-nums">{video.likeCount}</span>
        </button>
      </div>
    </div>
  );
}

export default function Explore() {
  const { isAuthenticated, user } = useAuth();
  const [, setLocation] = useLocation();
  const [videos, setVideos] = useState<GalleryVideo[]>([]);
  const [activeVideo, setActiveVideo] = useState<GalleryVideo | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [soundtracks, setSoundtracks] = useState<PublicSoundtrack[]>([]);
  const isAdmin = !!user?.isAdmin;

  useSEO({
    title: "Explore — Community AI Music Videos",
    description:
      "Discover the best community-made AI music videos. Beat-synced, cinematic visuals created with AIBeatSync. Like your favorites — no account needed to watch.",
    canonical: "/explore",
    jsonLd:
      videos.length > 0
        ? {
            "@context": "https://schema.org",
            "@type": "ItemList",
            name: "Community AI Music Videos",
            itemListElement: videos.slice(0, 20).map((v, i) => ({
              "@type": "ListItem",
              position: i + 1,
              name: v.title || "AI music video",
            })),
          }
        : null,
  });

  async function load(p: number) {
    setLoading(true);
    try {
      const res = await fetch(`/api/gallery?page=${p}&limit=${PAGE_SIZE}`, { credentials: "include" });
      const data = await res.json();
      setTotal(data.total ?? 0);
      setVideos((prev) => (p === 1 ? data.videos : [...prev, ...data.videos]));
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(1);
    fetch("/api/music/public")
      .then((r) => (r.ok ? r.json() : { soundtracks: [] }))
      .then((d) => setSoundtracks(d.soundtracks ?? []))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onLikeToggle(v: GalleryVideo) {
    if (!isAuthenticated) {
      setLocation("/login");
      return;
    }
    const liked = !v.liked;
    // optimistic
    setVideos((prev) =>
      prev.map((x) => (x.id === v.id ? { ...x, liked, likeCount: x.likeCount + (liked ? 1 : -1) } : x)),
    );
    try {
      const res = await fetch(`/api/videos/${v.id}/like`, {
        method: liked ? "POST" : "DELETE",
        credentials: "include",
      });
      const data = await res.json();
      if (typeof data.likeCount === "number") {
        setVideos((prev) => prev.map((x) => (x.id === v.id ? { ...x, likeCount: data.likeCount, liked } : x)));
      }
    } catch {
      // revert
      setVideos((prev) =>
        prev.map((x) => (x.id === v.id ? { ...x, liked: v.liked, likeCount: v.likeCount } : x)),
      );
    }
  }

  async function onSoundtrackLike(s: PublicSoundtrack) {
    if (!isAuthenticated) {
      setLocation("/login");
      return;
    }
    const liked = !s.liked;
    setSoundtracks((prev) => prev.map((x) => (x.id === s.id ? { ...x, liked, likeCount: x.likeCount + (liked ? 1 : -1) } : x)));
    try {
      const res = await fetch(`/api/music/soundtracks/${s.id}/like`, { method: liked ? "POST" : "DELETE", credentials: "include" });
      const data = await res.json();
      if (typeof data.likeCount === "number") {
        setSoundtracks((prev) => prev.map((x) => (x.id === s.id ? { ...x, likeCount: data.likeCount, liked } : x)));
      }
    } catch {
      setSoundtracks((prev) => prev.map((x) => (x.id === s.id ? { ...x, liked: s.liked, likeCount: s.likeCount } : x)));
    }
  }

  async function onUnpublish(v: GalleryVideo) {
    setVideos((prev) => prev.filter((x) => x.id !== v.id));
    try {
      await fetch(`/api/videos/${v.id}/visibility`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPublic: false }),
      });
    } catch {
      /* ignore */
    }
  }

  const hasMore = videos.length < total;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10">
      <header className="mb-10 text-center">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Explore the community</h1>
        <p className="text-muted-foreground mx-auto mt-3 max-w-2xl">
          Videos and royalty-free soundtracks made by the AIBeatSync community. Watch, listen, get inspired, and
          reuse your favorites.
        </p>
      </header>

      {soundtracks.length > 0 && (
        <section className="mb-12">
          <div className="mb-4 flex items-center gap-2">
            <Music2 className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-semibold">Community soundtracks</h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {soundtracks.map((s) => {
              const title = encodeURIComponent(s.title || "AI Soundtrack");
              return (
                <div key={s.id} className="overflow-hidden rounded-xl border border-card-border bg-card shadow-lg transition-all hover:border-primary/50">
                  <div className="h-1 w-full bg-gradient-electric" />
                  <div className="p-4">
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-medium text-primary">
                          {(s.creatorName || "A").trim().charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium" title={s.title || "Untitled"}>{s.title || "AI Soundtrack"}</p>
                          <p className="text-xs text-muted-foreground">by {s.creatorName || "a creator"}</p>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          onClick={() => onSoundtrackLike(s)}
                          className={`flex items-center gap-1 text-sm transition-colors ${s.liked ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
                          title={isAuthenticated ? (s.liked ? "Unlike" : "Like") : "Sign in to like"}
                        >
                          <Heart className={`h-4 w-4 ${s.liked ? "fill-current" : ""}`} />
                          <span className="tabular-nums text-xs">{s.likeCount}</span>
                        </button>
                        <a href={s.url} download title="Download" className="text-muted-foreground hover:text-primary">
                          <Download className="h-4 w-4" />
                        </a>
                      </div>
                    </div>
                    <audio controls preload="none" src={s.url} className="h-9 w-full" />
                    <div className="mt-3 flex items-center gap-2">
                      <Button size="sm" className="h-8 border-0 bg-gradient-electric text-white" onClick={() => setLocation(`/editor?audio=${encodeURIComponent(s.url)}&title=${title}`)}>
                        <Scissors className="mr-1.5 h-3.5 w-3.5" /> Remix
                      </Button>
                      <Button size="sm" variant="outline" className="h-8" onClick={() => setLocation(`/generate?audioObjectPath=${encodeURIComponent(s.objectPath)}&title=${title}`)}>
                        <Video className="mr-1.5 h-3.5 w-3.5" /> Generate
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <div className="mb-4 flex items-center gap-2">
        <Video className="h-5 w-5 text-primary" />
        <h2 className="text-xl font-semibold">Community videos</h2>
      </div>

      {loading && videos.length === 0 ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="text-primary h-8 w-8 animate-spin" />
        </div>
      ) : videos.length === 0 ? (
        <div className="text-muted-foreground flex flex-col items-center justify-center gap-3 py-24">
          <Globe className="h-10 w-10 opacity-40" />
          <p>No public videos yet — be the first to share one from your gallery.</p>
        </div>
      ) : (
        <>
          <div className="columns-1 gap-4 sm:columns-2 lg:columns-3 xl:columns-4">
            {videos.map((v) => (
              <VideoCard
                key={v.id}
                video={v}
                isAuthed={isAuthenticated}
                isAdmin={isAdmin}
                onLikeToggle={onLikeToggle}
                onUnpublish={onUnpublish}
                onOpen={setActiveVideo}
              />
            ))}
          </div>
          {/* Full player with sound — opened by clicking a card. */}
          <Dialog open={!!activeVideo} onOpenChange={(open) => !open && setActiveVideo(null)}>
            <DialogContent className="max-w-4xl border-card-border bg-black p-0 sm:rounded-xl overflow-hidden">
              <DialogTitle className="sr-only">
                {activeVideo?.title || "AI music video"}
              </DialogTitle>
              {activeVideo && (
                <video
                  key={activeVideo.id}
                  src={`/api/storage${activeVideo.videoObjectPath}`}
                  controls
                  autoPlay
                  playsInline
                  className="max-h-[80vh] w-full bg-black"
                />
              )}
            </DialogContent>
          </Dialog>
          {hasMore && (
            <div className="mt-8 flex justify-center">
              <Button
                variant="outline"
                disabled={loading}
                onClick={() => {
                  const next = page + 1;
                  setPage(next);
                  load(next);
                }}
              >
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Load more
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
