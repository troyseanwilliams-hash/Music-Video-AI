import { useEffect, useState } from "react";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import {
  useListVideos,
  useDeleteVideo,
  getListVideosQueryKey,
  getGetDashboardStatsQueryKey,
  useUpdateImageAssetVisibility,
} from "@workspace/api-client-react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import LipSyncPanel from "@/components/LipSyncPanel";
import { LIPSYNC_MIN_SECONDS } from "@/lib/creditPricing";
import {
  Loader2, Trash2, Play, Film, Download, Scissors, Globe, Pencil, X, Music, Music2, Video,
  UserRound, Smile, Image as ImageIcon, Check,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { motion } from "framer-motion";
import {
  IMAGE_REMIX_KIND,
  type ImageRemixAsset,
} from "@/lib/imageRemixHandoff";
import { orderGalleryImages } from "@/lib/imageGallery";

interface ImageAsset extends ImageRemixAsset {
  id: string;
  jobId: string;
  createdAt: string;
  isPublic: boolean;
  isCreatorAnonymous: boolean;
}

interface ImageAssetsPage {
  assets: ImageAsset[];
  total: number;
  page: number;
  limit: number;
}

interface GallerySoundtrack {
  id: string;
  title: string | null;
  prompt: string | null;
  objectPath: string;
  ext: string;
  durationSeconds: number | null;
  loopedToSeconds: number | null;
  isPublic: boolean;
  createdAt: string;
  url: string;
}

function VideoThumbnail({ src, alt }: { src: string; alt: string }) {
  const [error, setError] = useState(false);
  if (error) {
    return (
      <div className="absolute inset-0 flex items-center justify-center">
        <Film className="h-12 w-12 text-muted-foreground/50" />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="eager"
      className="absolute inset-0 object-cover w-full h-full"
      onError={() => setError(true)}
    />
  );
}

async function getSignedVideoUrl(jobId: string): Promise<string> {
  const r = await fetch(`/api/jobs/${jobId}/video-url`);
  if (!r.ok) throw new Error("url");
  const { url } = await r.json() as { url: string };
  return url;
}

export default function Gallery() {
  const [, setLocation] = useLocation();
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [galleryView, setGalleryView] = useState<"videos" | "images" | "music">("videos");
  const [loadingAction, setLoadingAction] = useState<Record<string, "watch" | "download" | undefined>>({});
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [player, setPlayer] = useState<{ url: string; title: string } | null>(null);
  const [lipSyncVideo, setLipSyncVideo] = useState<{
    id: string;
    title: string;
    durationSeconds: number;
  } | null>(null);
  const [selectedImageIds, setSelectedImageIds] = useState<string[]>([]);
  const [previewImage, setPreviewImage] = useState<ImageAsset | null>(null);
  const [deletingImageId, setDeletingImageId] = useState<string | null>(null);
  const [downloadingImageId, setDownloadingImageId] = useState<string | null>(null);
  const [imageActionError, setImageActionError] = useState<string | null>(null);
  const [trackSearch, setTrackSearch] = useState("");
  const [trackSort, setTrackSort] = useState<"new" | "old" | "name">("new");

  const imageAssetsQuery = useInfiniteQuery({
    queryKey: ["generated-image-gallery"],
    initialPageParam: 1,
    enabled: isAuthenticated && galleryView === "images",
    queryFn: async ({ pageParam }) => {
      const response = await fetch(
        `/api/image-assets?page=${pageParam}&limit=24`,
        { credentials: "include" },
      );
      if (!response.ok) throw new Error("Failed to load generated images");
      return response.json() as Promise<ImageAssetsPage>;
    },
    getNextPageParam: (lastPage) =>
      lastPage.page * lastPage.limit < lastPage.total
        ? lastPage.page + 1
        : undefined,
  });
  const soundtracksQuery = useQuery<GallerySoundtrack[]>({
    queryKey: ["soundtracks"],
    queryFn: async () => {
      const response = await fetch("/api/music/soundtracks", {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to load soundtracks");
      const payload = await response.json() as { soundtracks?: GallerySoundtrack[] };
      return Array.isArray(payload.soundtracks) ? payload.soundtracks : [];
    },
    enabled: isAuthenticated && galleryView === "music",
  });
  const generatedImages = (() => {
    const assets = imageAssetsQuery.data?.pages.flatMap((page) => page.assets) ?? [];
    return orderGalleryImages(assets);
  })();
  const selectedImages = selectedImageIds.flatMap((id) => {
    const asset = generatedImages.find((candidate) => candidate.id === id);
    return asset ? [asset] : [];
  });
  const visibleSoundtracks = (soundtracksQuery.data ?? [])
    .filter((track) => {
      const query = trackSearch.trim().toLowerCase();
      if (!query) return true;
      return (
        (track.title || "").toLowerCase().includes(query) ||
        (track.prompt || "").toLowerCase().includes(query)
      );
    })
    .sort((a, b) => {
      if (trackSort === "name") {
        return (a.title || "AI Soundtrack").localeCompare(b.title || "AI Soundtrack");
      }
      const aTime = new Date(a.createdAt).getTime();
      const bTime = new Date(b.createdAt).getTime();
      return trackSort === "old" ? aTime - bTime : bTime - aTime;
    });

  function toggleImageSelection(id: string) {
    setSelectedImageIds((selected) =>
      selected.includes(id)
        ? selected.filter((imageId) => imageId !== id)
        : [...selected, id],
    );
  }

  function addSelectedImagesToRemix() {
    if (selectedImages.length === 0) return;
    const orderedImages = [...selectedImages].sort((a, b) => {
      if (a.jobId === b.jobId) return a.assetIndex - b.assetIndex;
      return selectedImageIds.indexOf(a.id) - selectedImageIds.indexOf(b.id);
    });
    sessionStorage.setItem(
      "editor:init",
      JSON.stringify({
        kind: IMAGE_REMIX_KIND,
        images: orderedImages.map(({ objectPath, prompt, assetIndex }) => ({
          objectPath,
          prompt,
          assetIndex,
        })),
      }),
    );
    setLocation("/editor");
  }

  async function deleteImage(asset: ImageAsset) {
    setDeletingImageId(asset.id);
    setImageActionError(null);
    try {
      const response = await fetch(`/api/image-assets/${asset.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Could not delete this image.");
      setSelectedImageIds((selected) => selected.filter((id) => id !== asset.id));
      if (previewImage?.id === asset.id) setPreviewImage(null);
      await queryClient.invalidateQueries({ queryKey: ["generated-image-gallery"] });
    } catch (error) {
      setImageActionError(
        error instanceof Error ? error.message : "Could not delete this image.",
      );
    } finally {
      setDeletingImageId(null);
    }
  }

  async function saveRename(videoId: string) {
    const title = renameValue.trim();
    if (!title) { setRenamingId(null); return; }
    try {
      await fetch(`/api/videos/${videoId}/title`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      queryClient.invalidateQueries({ queryKey: getListVideosQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetDashboardStatsQueryKey() });
    } catch {
      /* ignore */
    } finally {
      setRenamingId(null);
    }
  }

  async function updateExploreSettings(
    videoId: string,
    makePublic: boolean,
    isCreatorAnonymous?: boolean,
  ) {
    setTogglingId(videoId);
    try {
      const response = await fetch(`/api/videos/${videoId}/visibility`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isPublic: makePublic,
          ...(isCreatorAnonymous === undefined ? {} : { isCreatorAnonymous }),
        }),
      });
      if (!response.ok) throw new Error("Unable to update Explore settings");
      queryClient.invalidateQueries({ queryKey: getListVideosQueryKey() });
    } catch {
      toast({
        title: "Update failed",
        description: "Could not update the video's visibility.",
        variant: "destructive"
      });
    } finally {
      setTogglingId(null);
    }
  }

  async function downloadImage(asset: ImageAsset) {
    setDownloadingImageId(asset.id);
    try {
      const response = await fetch(`/api/storage${asset.objectPath}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Could not download this image.");

      const blob = await response.blob();
      const extension = asset.objectPath.match(/\.([a-zA-Z0-9]+)(?:\?.*)?$/)?.[1] || "png";
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = `aibeatsync-image-${asset.assetIndex + 1}.${extension}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 5_000);
    } catch (error) {
      setImageActionError(
        error instanceof Error ? error.message : "Could not download this image.",
      );
    } finally {
      setDownloadingImageId(null);
    }
  }

  async function handleWatch(jobId: string, title?: string | null) {
    setLoadingAction(prev => ({ ...prev, [jobId]: "watch" }));
    try {
      const url = await getSignedVideoUrl(jobId);
      // Play inline in a modal. (window.open after an await gets popup-blocked.)
      setPlayer({ url, title: title || "Video" });
    } catch {
      // silently fail — signed URL unavailable
    } finally {
      setLoadingAction(prev => ({ ...prev, [jobId]: undefined }));
    }
  }

  async function handleDownload(jobId: string, title?: string | null) {
    setLoadingAction(prev => ({ ...prev, [jobId]: "download" }));
    try {
      const url = await getSignedVideoUrl(jobId);
      const vr = await fetch(url);
      if (!vr.ok) throw new Error("fetch");
      const blob = await vr.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `beatvision-${title || jobId}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
    } catch {
      // silently fail
    } finally {
      setLoadingAction(prev => ({ ...prev, [jobId]: undefined }));
    }
  }

  function useTrackInGenerate(track: GallerySoundtrack) {
    const title = encodeURIComponent(track.title || "AI Soundtrack");
    setLocation(
      `/generate?audioObjectPath=${encodeURIComponent(track.objectPath)}&title=${title}`,
    );
  }

  function useTrackInRemix(track: GallerySoundtrack) {
    const title = encodeURIComponent(track.title || "AI Soundtrack");
    setLocation(`/editor?audio=${encodeURIComponent(track.url)}&title=${title}`);
  }

  const { data, isLoading } = useListVideos(
    { limit: 20 },
    { query: { queryKey: getListVideosQueryKey({ limit: 20 }), enabled: isAuthenticated } }
  );

  const deleteVideo = useDeleteVideo({
    mutation: {
      onSuccess: () => {
        // Refresh the library list AND the dashboard (its video count and
        // recent-generations list must drop the deleted video too).
        queryClient.invalidateQueries({ queryKey: getListVideosQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetDashboardStatsQueryKey() });
      }
    }
  });

  const updateImageVisibility = useUpdateImageAssetVisibility({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["generated-image-gallery"] });
      }
    }
  });

  async function toggleImageVisibility(
    imageId: string,
    isPublic: boolean,
    isCreatorAnonymous?: boolean,
  ) {
    setTogglingId(imageId);
    try {
      await updateImageVisibility.mutateAsync({
        id: imageId,
        data: {
          isPublic,
          ...(isCreatorAnonymous !== undefined ? { isCreatorAnonymous } : {}),
        },
      });
    } catch {
      toast({
        title: "Update failed",
        description: "Could not update the image's visibility.",
        variant: "destructive"
      });
    } finally {
      setTogglingId(null);
    }
  }

  useEffect(() => {
    if (!isAuthLoading && !isAuthenticated) {
      setLocation("/login");
    }
  }, [isAuthenticated, isAuthLoading, setLocation]);

  if (isAuthLoading || !isAuthenticated) return null;

  return (
    <div className="container mx-auto px-4 py-6 sm:py-12 max-w-7xl">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 sm:mb-10 gap-4">
        <div>
          <h1 className="text-2xl sm:text-4xl font-bold tracking-tight">Your Gallery</h1>
          <p className="text-sm sm:text-base text-muted-foreground mt-1">
            {galleryView === "videos"
              ? "All your generated AI music videos."
              : galleryView === "images"
                ? "Every saved image you have generated, ready for Remix Lab."
                : "Your saved AI soundtracks, ready to play or use in a project."}
          </p>
        </div>

        <Link href="/generate">
          <Button className="bg-gradient-electric text-white shadow-glow">
            Create new
          </Button>
        </Link>
      </div>

      <div className="mb-6 flex w-fit rounded-lg border border-border bg-card/60 p-1" role="tablist" aria-label="Gallery content">
        <button
          type="button"
          role="tab"
          aria-selected={galleryView === "videos"}
          onClick={() => setGalleryView("videos")}
          className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
            galleryView === "videos"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Film className="h-4 w-4" /> Videos
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={galleryView === "images"}
          onClick={() => setGalleryView("images")}
          className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
            galleryView === "images"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <ImageIcon className="h-4 w-4" /> Images
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={galleryView === "music"}
          onClick={() => setGalleryView("music")}
          className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
            galleryView === "music"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Music2 className="h-4 w-4" /> Music
        </button>
      </div>

      {galleryView === "videos" && (isLoading ? (
        <div className="flex items-center justify-center py-32">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : data && data.videos.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {data.videos.map((video, idx) => {
            const canAddLipSync =
              video.hasAudio !== false &&
              typeof video.durationSeconds === "number" &&
              video.durationSeconds >= LIPSYNC_MIN_SECONDS;

            return (
              <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05 }}
              key={video.id}
              className="group relative rounded-2xl bg-card border border-card-border overflow-hidden shadow-lg transition-all hover:border-primary/50 hover:shadow-glow flex flex-col"
            >
              {/* Thumbnail — clicking anywhere on it plays the video inline */}
              <button
                type="button"
                onClick={() => handleWatch(video.jobId, video.title)}
                className="block w-full text-left relative aspect-video bg-muted overflow-hidden"
              >
                {video.thumbnailObjectPath ? (
                  <VideoThumbnail
                    src={`/api/storage${video.thumbnailObjectPath}`}
                    alt={video.title || "Video thumbnail"}
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Film className="h-12 w-12 text-muted-foreground/50" />
                  </div>
                )}

                {/* Play overlay — transparent bg on mobile, dark on desktop hover */}
                <div className="absolute inset-0 bg-transparent group-hover:bg-black/50 flex items-center justify-center transition-all duration-200">
                  <div className="h-14 w-14 rounded-full bg-primary/90 flex items-center justify-center shadow-2xl transition-transform duration-200 group-hover:scale-110">
                    <Play className="h-7 w-7 text-white ml-1" />
                  </div>
                </div>

                {video.durationSeconds && (
                  <div className="absolute bottom-2 right-2 bg-black/80 px-2 py-1 rounded text-xs font-medium text-white backdrop-blur-sm">
                    {Math.floor(video.durationSeconds / 60)}:{(video.durationSeconds % 60).toFixed(2).padStart(5, "0")}
                  </div>
                )}
              </button>

              <div className="p-4 flex-1 flex flex-col gap-3">
                {renamingId === video.id ? (
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={() => saveRename(video.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveRename(video.id);
                      if (e.key === "Escape") setRenamingId(null);
                    }}
                    maxLength={120}
                    className="w-full rounded-md border border-primary bg-background px-2 py-1 text-base font-semibold focus:outline-none focus:ring-1 focus:ring-primary/30"
                    data-testid={`rename-input-${video.id}`}
                  />
                ) : (
                  <div className="flex items-start gap-1.5">
                    <Link href={`/jobs/${video.jobId}`} className="block min-w-0 flex-1">
                      <h3
                        className="font-semibold text-base line-clamp-2 hover:text-primary transition-colors"
                        title={video.prompt || video.title || "Untitled"}
                      >
                        {video.title || video.prompt || "Untitled"}
                      </h3>
                    </Link>
                    <button
                      onClick={() => { setRenameValue(video.title || video.prompt || ""); setRenamingId(video.id); }}
                      className="shrink-0 text-muted-foreground hover:text-primary transition-colors p-0.5"
                      title="Rename video"
                      data-testid={`rename-btn-${video.id}`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}

                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-medium px-2 py-1 rounded-md bg-secondary text-secondary-foreground capitalize">
                    {video.style}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(video.createdAt).toLocaleDateString()}
                  </span>
                  {(() => {
                    const isPublic = video.isPublic;
                    const isCreatorAnonymous = video.isCreatorAnonymous ?? false;
                    return (
                      <>
                        <button
                          onClick={() => updateExploreSettings(video.id, !isPublic)}
                          disabled={togglingId === video.id}
                          title={isPublic ? "Remove from Explore" : "Post to Explore"}
                          className={`text-xs font-medium px-2 py-1 rounded-md inline-flex items-center gap-1 ${
                            isPublic ? "bg-primary/15 text-primary" : "bg-secondary text-secondary-foreground hover:text-foreground"
                          }`}
                        >
                          {togglingId === video.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Globe className="h-3 w-3" />
                          )}
                          {isPublic ? "On Explore" : "Post to Explore"}
                        </button>
                        <button
                          onClick={() =>
                            updateExploreSettings(video.id, !!isPublic, !isCreatorAnonymous)
                          }
                          disabled={togglingId === video.id}
                          title={
                            isCreatorAnonymous
                              ? "This post does not expose your profile name. Click to turn anonymity off."
                              : "Post this video anonymously on Explore"
                          }
                          className={`text-xs font-medium px-2 py-1 rounded-md inline-flex items-center gap-1 ${
                            isCreatorAnonymous
                              ? "bg-primary/15 text-primary"
                              : "bg-secondary text-secondary-foreground hover:text-foreground"
                          }`}
                        >
                          <UserRound className="h-3 w-3" />
                          {isCreatorAnonymous ? "Anonymous" : "Post anonymously"}
                        </button>
                      </>
                    );
                  })()}
                </div>

                <div className="flex items-center gap-2 mt-auto pt-1">
                  <Button
                    size="sm"
                    className="flex-1 bg-gradient-electric text-white shadow-glow text-xs h-8"
                    disabled={!!loadingAction[video.jobId]}
                    onClick={() => handleWatch(video.jobId, video.title)}
                  >
                    {loadingAction[video.jobId] === "watch"
                      ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                      : <Play className="h-3.5 w-3.5 mr-1.5" />}
                    Watch
                  </Button>

                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    title="Download video"
                    aria-label="Download video"
                    disabled={!!loadingAction[video.jobId]}
                    onClick={() => handleDownload(video.jobId, video.title || video.prompt)}
                  >
                    {loadingAction[video.jobId] === "download"
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <Download className="h-3.5 w-3.5" />}
                  </Button>

                  <Button
                    variant={video.hasAudio === false ? "default" : "outline"}
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    title={video.hasAudio === false ? "Add Music" : "Open in Remix Lab"}
                    aria-label={video.hasAudio === false ? "Add Music" : "Open in Remix Lab"}
                    onClick={() => {
                      sessionStorage.setItem(
                        "editor:init",
                        JSON.stringify({
                          video: {
                            objectPath: video.videoObjectPath,
                            thumbPath: video.thumbnailObjectPath,
                            durationSec: video.durationSeconds,
                            name: video.title || video.prompt || "Generated video",
                          },
                        }),
                      );
                      setLocation("/editor");
                    }}
                  >
                    {video.hasAudio === false ? <Music className="h-3.5 w-3.5" /> : <Scissors className="h-3.5 w-3.5" />}
                  </Button>

                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    title={
                      canAddLipSync
                        ? "Add Lip Sync"
                        : `Lip Sync needs at least ${LIPSYNC_MIN_SECONDS} seconds of source audio`
                    }
                    aria-label={
                      canAddLipSync
                        ? `Add Lip Sync to ${video.title || video.prompt || "video"}`
                        : "Lip Sync unavailable because this video has no usable source audio"
                    }
                    disabled={!canAddLipSync}
                    onClick={() =>
                      setLipSyncVideo({
                        id: video.id,
                        title: video.title || video.prompt || "Video",
                        durationSeconds: video.durationSeconds!,
                      })
                    }
                  >
                    <Smile className="h-3.5 w-3.5" />
                  </Button>

                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors" aria-label="Delete video">
                        {deleteVideo.isPending && deleteVideo.variables?.id === video.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete this video?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This action cannot be undone. This will permanently delete the video and its associated files.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => deleteVideo.mutate({ id: video.id })}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
                {!canAddLipSync && (
                  <p className="text-[11px] text-muted-foreground">
                    Lip Sync needs at least {LIPSYNC_MIN_SECONDS} seconds of source audio.
                  </p>
                )}
              </div>
            </motion.div>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-16 sm:py-32 border border-dashed border-border rounded-2xl bg-card/30">
          <Film className="h-12 w-12 sm:h-16 sm:w-16 text-muted-foreground mx-auto mb-4 sm:mb-6 opacity-20" />
          <h3 className="text-xl font-medium mb-2">Your gallery is empty</h3>
          <p className="text-muted-foreground mb-8 max-w-md mx-auto">
            You haven't generated any videos yet. Start creating your first AI music video now.
          </p>
          <Link href="/generate">
            <Button size="lg" className="bg-gradient-electric text-white shadow-glow">
              Generate Video
            </Button>
          </Link>
        </div>
      ))}

      {galleryView === "images" && (
        imageAssetsQuery.isLoading ? (
          <div className="flex items-center justify-center py-32">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : imageAssetsQuery.isError ? (
          <div className="text-center py-16 border border-dashed border-border rounded-2xl bg-card/30">
            <p className="font-medium">Couldn't load your generated images.</p>
            <Button variant="outline" className="mt-4" onClick={() => imageAssetsQuery.refetch()}>
              Try again
            </Button>
          </div>
        ) : generatedImages.length > 0 ? (
          <div className="space-y-5">
            <div className="flex flex-col gap-3 rounded-xl border border-primary/20 bg-primary/[0.04] p-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                {selectedImageIds.length
                  ? `${selectedImageIds.length} ${selectedImageIds.length === 1 ? "image selected" : "images selected"}`
                  : "Select images to build a Remix timeline."}
              </p>
              <div className="flex gap-2">
                {selectedImageIds.length > 0 && (
                  <Button variant="ghost" size="sm" onClick={() => setSelectedImageIds([])}>
                    Clear selection
                  </Button>
                )}
                <Button
                  size="sm"
                  className="bg-gradient-electric text-white shadow-glow"
                  disabled={selectedImages.length === 0}
                  onClick={addSelectedImagesToRemix}
                >
                  <Scissors className="mr-2 h-4 w-4" />
                  Add to Remix Lab
                </Button>
              </div>
            </div>

            {imageActionError && (
              <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {imageActionError}
              </p>
            )}

            <div className="columns-2 sm:columns-3 lg:columns-4 xl:columns-5 gap-4 space-y-4">
              {generatedImages.map((asset, index) => {
                const selectedIndex = selectedImageIds.indexOf(asset.id);
                const selected = selectedIndex !== -1;
                return (
                  <motion.article
                    key={asset.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(index, 12) * 0.03 }}
                    className={`break-inside-avoid overflow-hidden rounded-xl border bg-card shadow-sm transition-colors ${
                      selected ? "border-primary ring-1 ring-primary/50" : "border-card-border hover:border-primary/40"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setPreviewImage(asset)}
                      className="group relative block w-full overflow-hidden bg-muted/30 text-left"
                      aria-label={`Open generated image ${asset.assetIndex + 1}`}
                    >
                      <img
                        src={`/api/storage${asset.objectPath}`}
                        alt={asset.prompt || `Generated image ${asset.assetIndex + 1}`}
                        loading="lazy"
                        className="w-full h-auto object-contain transition-transform duration-300 group-hover:scale-[1.03]"
                      />
                      <div className="absolute top-2 left-2 flex flex-col items-start gap-1.5">
                        <span className="rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-white backdrop-blur-md">
                          Scene {asset.assetIndex + 1}
                        </span>
                      </div>
                      {selected && (
                        <div className="absolute inset-0 ring-inset ring-2 ring-primary bg-primary/10 flex items-center justify-center">
                          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground shadow-lg shadow-black/20 ring-2 ring-background">
                            {selectedIndex + 1}
                          </span>
                        </div>
                      )}
                    </button>
                      <div className="flex flex-col gap-3 p-3">
                      <p className="line-clamp-2 min-h-10 text-xs leading-relaxed text-muted-foreground" title={asset.prompt}>
                        {asset.prompt}
                      </p>
                      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                        <span>{new Date(asset.createdAt).toLocaleDateString()}</span>
                        <span>Image pack</span>
                      </div>

                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          onClick={() => toggleImageVisibility(asset.id, !asset.isPublic)}
                          disabled={togglingId === asset.id}
                          title={asset.isPublic ? "Remove from Explore" : "Post to Explore"}
                          className={`text-[10px] font-medium px-2 py-1 rounded-md inline-flex items-center gap-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                            asset.isPublic ? "bg-primary/15 text-primary" : "bg-secondary text-secondary-foreground hover:text-foreground"
                          }`}
                          data-testid={`toggle-image-visibility-${asset.id}`}
                        >
                          {togglingId === asset.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Globe className="h-3 w-3" />
                          )}
                          {asset.isPublic ? "On Explore" : "Post to Explore"}
                        </button>
                        <button
                          onClick={() => toggleImageVisibility(asset.id, !!asset.isPublic, !asset.isCreatorAnonymous)}
                          disabled={togglingId === asset.id}
                          title={
                            asset.isCreatorAnonymous
                              ? "This post does not expose your profile name. Click to turn anonymity off."
                              : "Post this image anonymously on Explore"
                          }
                          className={`text-[10px] font-medium px-2 py-1 rounded-md inline-flex items-center gap-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                            asset.isCreatorAnonymous
                              ? "bg-primary/15 text-primary"
                              : "bg-secondary text-secondary-foreground hover:text-foreground"
                          }`}
                          data-testid={`toggle-image-anonymous-${asset.id}`}
                        >
                          <UserRound className="h-3 w-3" />
                          {asset.isCreatorAnonymous ? "Anonymous" : "Post anonymously"}
                        </button>
                      </div>

                      <div className="flex items-center gap-2">
                        <Button
                          variant={selected ? "default" : "outline"}
                          size="sm"
                          className={`h-8 flex-1 text-xs transition-colors ${selected ? "bg-primary text-primary-foreground" : ""}`}
                          onClick={() => toggleImageSelection(asset.id)}
                          aria-pressed={selected}
                        >
                          {selected ? (
                            <span className="mr-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary-foreground/20 text-[9px] font-bold">
                              {selectedIndex + 1}
                            </span>
                          ) : null}
                          {selected ? "Selected" : "Select"}
                        </Button>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8 shrink-0"
                          title="Download image"
                          aria-label={`Download generated image ${asset.assetIndex + 1}`}
                          disabled={downloadingImageId === asset.id}
                          onClick={() => void downloadImage(asset)}
                        >
                          {downloadingImageId === asset.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Download className="h-3.5 w-3.5" />
                          )}
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                              aria-label={`Delete generated image ${asset.assetIndex + 1}`}
                              disabled={deletingImageId === asset.id}
                            >
                              {deletingImageId === asset.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Trash2 className="h-3.5 w-3.5" />
                              )}
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete this generated image?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This removes the image from your gallery and Remix Lab. This cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => void deleteImage(asset)}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  </motion.article>
                );
              })}
            </div>

            {imageAssetsQuery.hasNextPage && (
              <div className="flex justify-center pt-2">
                <Button
                  variant="outline"
                  onClick={() => imageAssetsQuery.fetchNextPage()}
                  disabled={imageAssetsQuery.isFetchingNextPage}
                >
                  {imageAssetsQuery.isFetchingNextPage ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  Load older images
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-16 sm:py-32 border border-dashed border-border rounded-2xl bg-card/30">
            <ImageIcon className="h-12 w-12 sm:h-16 sm:w-16 text-muted-foreground mx-auto mb-4 sm:mb-6 opacity-20" />
            <h3 className="text-xl font-medium mb-2">No generated images yet</h3>
            <p className="text-muted-foreground mb-8 max-w-md mx-auto">
              Create an Images-only pack and every finished image will appear here.
            </p>
            <Link href="/generate">
              <Button size="lg" className="bg-gradient-electric text-white shadow-glow">
                Generate Images
              </Button>
            </Link>
          </div>
        )
      )}

      {galleryView === "music" && (
        soundtracksQuery.isLoading ? (
          <div className="flex items-center justify-center py-32">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : soundtracksQuery.isError ? (
          <div className="text-center py-16 sm:py-32 border border-dashed border-border rounded-2xl bg-card/30">
            <Music2 className="h-12 w-12 sm:h-16 sm:w-16 text-muted-foreground mx-auto mb-4 sm:mb-6 opacity-20" />
            <h3 className="text-xl font-medium mb-2">Couldn't load your music</h3>
            <p className="text-muted-foreground mb-6 max-w-md mx-auto">
              Your saved tracks are temporarily unavailable. Try again in a moment.
            </p>
            <Button
              variant="outline"
              onClick={() => soundtracksQuery.refetch()}
              disabled={soundtracksQuery.isRefetching}
            >
              {soundtracksQuery.isRefetching && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Try again
            </Button>
          </div>
        ) : soundtracksQuery.data?.length === 0 ? (
          <div className="text-center py-16 sm:py-32 border border-dashed border-border rounded-2xl bg-card/30">
            <Music2 className="h-12 w-12 sm:h-16 sm:w-16 text-muted-foreground mx-auto mb-4 sm:mb-6 opacity-20" />
            <h3 className="text-xl font-medium mb-2">No music tracks yet</h3>
            <p className="text-muted-foreground mb-8 max-w-md mx-auto">
              Generate a soundtrack and it will appear here automatically, ready to play or add to a project.
            </p>
            <Link href="/soundtracks">
              <Button size="lg" className="bg-gradient-electric text-white shadow-glow">
                Create a soundtrack
              </Button>
            </Link>
          </div>
        ) : visibleSoundtracks.length === 0 ? (
          <div className="space-y-5">
            <div className="flex flex-col gap-3 rounded-xl border border-border bg-card/40 p-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                No tracks match “{trackSearch}”.
              </p>
              <Button variant="ghost" size="sm" onClick={() => setTrackSearch("")}>
                Clear search
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="flex flex-col gap-3 rounded-xl border border-primary/20 bg-primary/[0.04] p-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                {visibleSoundtracks.length}{" "}
                {visibleSoundtracks.length === 1 ? "saved track" : "saved tracks"}
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  value={trackSearch}
                  onChange={(event) => setTrackSearch(event.target.value)}
                  placeholder="Search music…"
                  aria-label="Search saved music"
                  className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm focus:border-primary focus:outline-none sm:w-48"
                />
                <select
                  value={trackSort}
                  onChange={(event) => setTrackSort(event.target.value as "new" | "old" | "name")}
                  aria-label="Sort saved music"
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm focus:border-primary focus:outline-none"
                >
                  <option value="new">Newest</option>
                  <option value="old">Oldest</option>
                  <option value="name">Name (A–Z)</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {visibleSoundtracks.map((track, index) => {
                const title = track.title || "AI Soundtrack";
                const fileName = `${title.replace(/[^\w-]+/g, "_")}.${track.ext || "mp3"}`;
                const duration = track.loopedToSeconds || track.durationSeconds;
                return (
                  <motion.article
                    key={track.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(index, 12) * 0.04 }}
                    className="overflow-hidden rounded-2xl border border-card-border bg-card shadow-sm transition-colors hover:border-primary/40"
                  >
                    <div className="h-1 w-full bg-gradient-electric" />
                    <div className="space-y-4 p-4">
                      <div className="flex items-start gap-3">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                          <Music2 className="h-5 w-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <h3 className="truncate font-semibold" title={title}>{title}</h3>
                          {track.prompt && (
                            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                              {track.prompt}
                            </p>
                          )}
                        </div>
                        {track.isPublic && (
                          <span className="shrink-0 rounded-full border border-primary/30 px-2 py-0.5 text-[10px] text-primary">
                            Public
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                        {duration ? (
                          <span className="rounded-full border border-border px-2 py-0.5">
                            {Math.floor(duration / 60)}:{String(duration % 60).padStart(2, "0")}
                            {track.loopedToSeconds ? " (looped)" : ""}
                          </span>
                        ) : null}
                        <span className="rounded-full border border-border px-2 py-0.5">
                          {new Date(track.createdAt).toLocaleDateString()}
                        </span>
                      </div>

                      <audio
                        controls
                        preload="none"
                        src={track.url}
                        aria-label={`Play ${title}`}
                        className="h-9 w-full"
                      />

                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          onClick={() => useTrackInRemix(track)}
                          className="bg-gradient-electric text-white shadow-glow"
                        >
                          <Scissors className="mr-1.5 h-3.5 w-3.5" /> Remix
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => useTrackInGenerate(track)}>
                          <Video className="mr-1.5 h-3.5 w-3.5" /> Generate
                        </Button>
                        <Button asChild size="sm" variant="outline">
                          <a href={track.url} download={fileName}>
                            <Download className="mr-1.5 h-3.5 w-3.5" /> Download
                          </a>
                        </Button>
                      </div>
                    </div>
                  </motion.article>
                );
              })}
            </div>
          </div>
        )
      )}

      {/* Inline video player */}
      {player && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
          onClick={() => setPlayer(null)}
        >
          <div
            className="relative flex max-h-[calc(100dvh-2rem)] w-full max-w-3xl flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between text-white">
              <span className="truncate text-sm font-medium">{player.title}</span>
              <button onClick={() => setPlayer(null)} aria-label="Close" className="text-white/70 hover:text-white">
                <X className="h-6 w-6" />
              </button>
            </div>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video
              src={player.url}
              controls
              autoPlay
              playsInline
              className="mx-auto max-h-[calc(100dvh-5rem)] max-w-full rounded-xl bg-black object-contain"
            />
          </div>
        </div>
      )}

      {previewImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
          onClick={() => setPreviewImage(null)}
        >
          <div
            className="relative flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-background shadow-2xl md:flex-row"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex min-h-64 flex-1 items-center justify-center bg-black">
              <img
                src={`/api/storage${previewImage.objectPath}`}
                alt={previewImage.prompt || `Generated image ${previewImage.assetIndex + 1}`}
                className="max-h-[70vh] max-w-full object-contain"
              />
            </div>
            <div className="w-full border-t border-border p-5 md:w-80 md:border-l md:border-t-0">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold">Generated image {previewImage.assetIndex + 1}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {new Date(previewImage.createdAt).toLocaleString()}
                  </p>
                </div>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setPreviewImage(null)} aria-label="Close image preview">
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <p className="mt-5 text-sm leading-relaxed text-muted-foreground">{previewImage.prompt}</p>
              <Button
                className={`mt-6 w-full ${selectedImageIds.includes(previewImage.id) ? "" : "bg-gradient-electric text-white shadow-glow"}`}
                variant={selectedImageIds.includes(previewImage.id) ? "outline" : "default"}
                onClick={() => {
                  toggleImageSelection(previewImage.id);
                  // Don't auto-close so the user sees the state change
                }}
              >
                {selectedImageIds.includes(previewImage.id) ? (
                  <>
                    <Check className="mr-2 h-4 w-4" />
                    Selected for Remix (Click to unselect)
                  </>
                ) : (
                  "Select for Remix"
                )}
              </Button>
              <Button
                className="mt-2 w-full"
                variant="outline"
                onClick={() => void downloadImage(previewImage)}
                disabled={downloadingImageId === previewImage.id}
              >
                {downloadingImageId === previewImage.id ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Download className="mr-2 h-4 w-4" />
                )}
                Download image
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* One panel at a time keeps the gallery light while still making Lip Sync
          available from every compatible video. */}
      {lipSyncVideo && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
          onClick={() => setLipSyncVideo(null)}
        >
          <div
            className="relative max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-background p-1 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-3 top-3 z-10 h-8 w-8"
              aria-label="Close Lip Sync"
              onClick={() => setLipSyncVideo(null)}
            >
              <X className="h-4 w-4" />
            </Button>
            <div className="px-5 pb-2 pt-5">
              <h2 className="pr-10 text-lg font-semibold">Add Lip Sync</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Create a separate 5–30 second performance clip from this video&apos;s original song. Your original video stays unchanged.
              </p>
              <p className="mt-1 truncate text-xs font-medium text-primary">{lipSyncVideo.title}</p>
            </div>
            <div className="p-4 pt-2">
              <LipSyncPanel
                videoId={lipSyncVideo.id}
                audioDurationSeconds={lipSyncVideo.durationSeconds}
                onCreated={() => {
                  queryClient.invalidateQueries({ queryKey: getListVideosQueryKey() });
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
