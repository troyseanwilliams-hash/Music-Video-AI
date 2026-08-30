import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { useSEO } from "@/hooks/useSEO";
import { Button } from "@/components/ui/button";
import { Heart, Play, Loader2, Globe, EyeOff } from "lucide-react";

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
}: {
  video: GalleryVideo;
  isAuthed: boolean;
  isAdmin: boolean;
  onLikeToggle: (v: GalleryVideo) => void;
  onUnpublish: (v: GalleryVideo) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hovering, setHovering] = useState(false);
  const initial = (video.creatorName || "A").trim().charAt(0).toUpperCase();

  return (
    <div className="group mb-4 break-inside-avoid overflow-hidden rounded-xl border border-card-border bg-card shadow-lg transition-all hover:border-primary/50">
      <div
        className="relative aspect-video bg-muted"
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
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
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
      <header className="mb-8 text-center">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Explore community videos</h1>
        <p className="text-muted-foreground mx-auto mt-3 max-w-2xl">
          The best beat-synced AI music videos made by the AIBeatSync community. Watch, get inspired, and like
          your favorites.
        </p>
      </header>

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
              />
            ))}
          </div>
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
