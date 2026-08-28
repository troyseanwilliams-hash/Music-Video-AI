import { useEffect, useRef, useState } from "react";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useSEO } from "@/hooks/useSEO";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Heart, Play, Loader2, Globe, EyeOff, Music2, Download, Scissors, Video, ImageIcon, Share2 } from "lucide-react";
import {
  useListPublicImageAssets,
  getListPublicImageAssetsQueryKey,
  useLikeImageAsset,
  useUnlikeImageAsset,
  useUpdateImageAssetVisibility,
  type PublicImageAsset
} from "@workspace/api-client-react";
import { useQueryClient, keepPreviousData } from "@tanstack/react-query";

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
          aria-label="Unpublish"
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
          <div className="min-w-0">
            <div className="truncate text-sm font-medium" title={video.title || "Untitled"}>
              {video.title || "Untitled"}
            </div>
            {video.creatorName === "Anonymous" && (
              <div className="text-xs text-muted-foreground">by Anonymous</div>
            )}
          </div>
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

function ImageCard({
  image,
  isAuthed,
  isAdmin,
  onLikeToggle,
  onUnpublish,
}: {
  image: PublicImageAsset;
  isAuthed: boolean;
  isAdmin: boolean;
  onLikeToggle: (id: string, currentlyLiked: boolean) => void;
  onUnpublish: (id: string) => void;
}) {
  const initial = (image.creatorName || "A").trim().charAt(0).toUpperCase();

  async function handleShare() {
    const url = `${window.location.origin}/image/${image.id}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "Check out this AI Image", url });
      } catch (err) {
        // ignore aborts
      }
    } else {
      await navigator.clipboard.writeText(url);
      alert("Link copied to clipboard!");
    }
  }

  return (
    <div className="group mb-4 break-inside-avoid overflow-hidden rounded-xl border border-card-border bg-card shadow-lg transition-all hover:border-primary/50 relative">
      <Link href={`/image/${image.id}`} className="block relative bg-muted group-hover:opacity-95 transition-opacity">
        <img
          src={`/api/storage${image.objectPath}`}
          alt={`AI generated image by ${image.creatorName || "anonymous creator"}`}
          loading="lazy"
          className="w-full h-auto object-cover"
        />
        {/* Style Badge */}
        {image.style && (
          <span className="absolute top-2 left-2 rounded bg-black/70 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur-md capitalize">
            {image.style}
          </span>
        )}
      </Link>

      {isAdmin && (
        <button
          title="Admin Unpublish"
          aria-label="Admin Unpublish"
          onClick={(e) => { e.preventDefault(); onUnpublish(image.id); }}
          className="absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white hover:bg-destructive"
          data-testid={`admin-unpublish-btn-${image.id}`}
        >
          <EyeOff className="h-3.5 w-3.5" />
        </button>
      )}

      <div className="flex items-center justify-between gap-2 p-3 relative z-10 bg-card">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-medium text-primary">
            {initial}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium" title={image.creatorName || "Anonymous"}>
              {image.creatorName || "Anonymous"}
            </div>
            <div className="text-[10px] text-muted-foreground">
              {new Date(image.createdAt).toLocaleDateString()}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => handleShare()}
            className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            title="Share link"
            aria-label="Share link"
            data-testid={`share-image-btn-${image.id}`}
          >
            <Share2 className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => onLikeToggle(image.id, image.liked)}
            className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
              image.liked ? "text-primary" : "text-muted-foreground hover:bg-primary/10 hover:text-foreground"
            }`}
            title={isAuthed ? (image.liked ? "Unlike image" : "Like image") : "Sign in to like image"}
            aria-label={isAuthed ? (image.liked ? "Unlike image" : "Like image") : "Sign in to like image"}
            data-testid={`like-image-btn-${image.id}`}
          >
            <Heart className={`h-4 w-4 ${image.liked ? "fill-current" : ""}`} />
            <span className="tabular-nums">{image.likeCount}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Explore() {
  const { isAuthenticated, user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [videos, setVideos] = useState<GalleryVideo[]>([]);
  const [activeVideo, setActiveVideo] = useState<GalleryVideo | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [soundtracks, setSoundtracks] = useState<PublicSoundtrack[]>([]);
  const isAdmin = !!user?.isAdmin;
  const queryClient = useQueryClient();

  const [imagePage, setImagePage] = useState(1);

  const { data: imageAssetsData, isLoading: isLoadingImages } = useListPublicImageAssets(
    { page: imagePage, limit: 12 },
    { query: { queryKey: getListPublicImageAssetsQueryKey({ page: imagePage, limit: 12 }), placeholderData: keepPreviousData } }
  );

  const likeImageAsset = useLikeImageAsset();
  const unlikeImageAsset = useUnlikeImageAsset();
  const updateImageVisibility = useUpdateImageAssetVisibility();

  async function onLikeImage(id: string, currentlyLiked: boolean) {
    if (!isAuthenticated) {
      setLocation("/login");
      return;
    }

    // Optimistic update
    queryClient.setQueryData(
      getListPublicImageAssetsQueryKey({ page: imagePage, limit: 12 }),
      (oldData: any) => {
        if (!oldData) return oldData;
        return {
          ...oldData,
          assets: oldData.assets.map((asset: PublicImageAsset) =>
            asset.id === id
              ? { ...asset, liked: !currentlyLiked, likeCount: asset.likeCount + (currentlyLiked ? -1 : 1) }
              : asset
          )
        };
      }
    );

    try {
      if (currentlyLiked) {
        await unlikeImageAsset.mutateAsync({ id });
      } else {
        await likeImageAsset.mutateAsync({ id });
      }
    } catch {
      // Rollback on error
      queryClient.invalidateQueries({ queryKey: getListPublicImageAssetsQueryKey({ page: imagePage, limit: 12 }) });
    }
  }

  async function onUnpublishImage(id: string) {
    try {
      await updateImageVisibility.mutateAsync({
        id,
        data: { isPublic: false }
      });
      queryClient.invalidateQueries({ queryKey: getListPublicImageAssetsQueryKey({ page: imagePage, limit: 12 }) });
      toast({
        title: "Image unpublished",
        description: "The image has been removed from Explore."
      });
    } catch {
      toast({
        title: "Unpublish failed",
        description: "Could not unpublish the image.",
        variant: "destructive"
      });
    }
  }

  useSEO({
    title: "Explore AI Videos, Images & Soundtracks",
    description:
      "Discover community-made AI music videos, generated images, and soundtracks. Browse and share creative work made with AIBeatSync.",
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
      const response = await fetch(`/api/videos/${v.id}/visibility`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPublic: false }),
      });
      if (!response.ok) throw new Error("Unable to unpublish");
      toast({
        title: "Video unpublished",
        description: "The video has been removed from Explore."
      });
    } catch {
      // Revert optimistic update
      setVideos((prev) => [...prev, v]);
      toast({
        title: "Unpublish failed",
        description: "Could not unpublish the video.",
        variant: "destructive"
      });
    }
  }

  const hasMore = videos.length < total;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10">
      <header className="mb-10 text-center">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Explore the community</h1>
        <p className="text-muted-foreground mx-auto mt-3 max-w-2xl">
          Videos, generated images, and soundtracks made by the AIBeatSync community. Watch, browse, listen, and get inspired.
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

      {/* Community Images */}
      <section className="mb-12">
        <div className="mb-4 flex items-center gap-2">
          <ImageIcon className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-semibold">Community images</h2>
        </div>

        {isLoadingImages ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="text-primary h-8 w-8 animate-spin" />
          </div>
        ) : !imageAssetsData?.assets?.length ? (
          <div className="text-muted-foreground flex flex-col items-center justify-center gap-3 py-16">
            <ImageIcon className="h-10 w-10 opacity-40" />
            <p>No public images yet — share one from your gallery.</p>
          </div>
        ) : (
          <>
            <div className="columns-2 sm:columns-3 lg:columns-4 gap-4 space-y-4">
              {imageAssetsData.assets.map((img) => (
                <ImageCard
                  key={img.id}
                  image={img}
                  isAuthed={isAuthenticated}
                  isAdmin={isAdmin}
                  onLikeToggle={onLikeImage}
                  onUnpublish={onUnpublishImage}
                />
              ))}
            </div>

            {/* Pagination Controls */}
            {imageAssetsData.total > 12 && (
              <div className="mt-8 flex justify-center gap-2">
                <Button
                  variant="outline"
                  disabled={imagePage === 1 || isLoadingImages}
                  onClick={() => setImagePage(p => Math.max(1, p - 1))}
                >
                  Previous
                </Button>
                <div className="flex items-center px-4 text-sm text-muted-foreground">
                  Page {imagePage} of {Math.ceil(imageAssetsData.total / 12)}
                </div>
                <Button
                  variant="outline"
                  disabled={imagePage >= Math.ceil(imageAssetsData.total / 12) || isLoadingImages}
                  onClick={() => setImagePage(p => p + 1)}
                >
                  Next
                </Button>
              </div>
            )}
          </>
        )}
      </section>

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
            <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-3xl overflow-hidden border-card-border bg-black p-0 sm:rounded-xl">
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
                  className="mx-auto max-h-[calc(100dvh-4rem)] max-w-full object-contain"
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
