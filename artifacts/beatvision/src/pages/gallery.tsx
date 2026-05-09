import { useEffect, useState } from "react";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { useListVideos, useDeleteVideo, getListVideosQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Loader2, Trash2, Play, Film, Download } from "lucide-react";
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

function VideoThumbnail({ src, alt }: { src: string; alt: string }) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  return (
    <>
      <div
        className={`absolute inset-0 flex items-center justify-center transition-opacity duration-300 ${loaded && !error ? "opacity-0 pointer-events-none" : "opacity-100"}`}
      >
        <Film className="h-12 w-12 text-muted-foreground/50" />
      </div>
      {!error && (
        <img
          src={src}
          alt={alt}
          loading="eager"
          className={`absolute inset-0 object-cover w-full h-full transition-opacity duration-500 ${loaded ? "opacity-100" : "opacity-0"}`}
          onLoad={() => setLoaded(true)}
          onError={() => setError(true)}
        />
      )}
    </>
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
  const queryClient = useQueryClient();
  const [loadingAction, setLoadingAction] = useState<Record<string, "watch" | "download" | undefined>>({});

  async function handleWatch(jobId: string) {
    setLoadingAction(prev => ({ ...prev, [jobId]: "watch" }));
    try {
      const url = await getSignedVideoUrl(jobId);
      window.open(url, "_blank", "noopener,noreferrer");
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

  const { data, isLoading } = useListVideos(
    { limit: 20 },
    { query: { enabled: isAuthenticated } }
  );

  const deleteVideo = useDeleteVideo({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListVideosQueryKey() });
      }
    }
  });

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
          <p className="text-sm sm:text-base text-muted-foreground mt-1">All your generated AI music videos.</p>
        </div>
        
        <Link href="/generate">
          <Button className="bg-gradient-electric text-white shadow-glow">
            New Video
          </Button>
        </Link>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-32">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : data && data.videos.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {data.videos.map((video, idx) => (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05 }}
              key={video.id}
              className="group relative rounded-2xl bg-card border border-card-border overflow-hidden shadow-lg transition-all hover:border-primary/50 hover:shadow-glow flex flex-col"
            >
              {/* Thumbnail — clicking anywhere on it goes to the job page */}
              <Link href={`/jobs/${video.jobId}`} className="block relative aspect-video bg-muted overflow-hidden">
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
              </Link>

              <div className="p-4 flex-1 flex flex-col gap-3">
                <Link href={`/jobs/${video.jobId}`} className="block">
                  <h3
                    className="font-semibold text-base line-clamp-2 hover:text-primary transition-colors"
                    title={video.prompt || video.title || "Untitled"}
                  >
                    {video.title || video.prompt || "Untitled"}
                  </h3>
                </Link>

                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-medium px-2 py-1 rounded-md bg-secondary text-secondary-foreground capitalize">
                    {video.style}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(video.createdAt).toLocaleDateString()}
                  </span>
                </div>

                <div className="flex items-center gap-2 mt-auto pt-1">
                  <Button
                    size="sm"
                    className="flex-1 bg-gradient-electric text-white shadow-glow text-xs h-8"
                    disabled={!!loadingAction[video.jobId]}
                    onClick={() => handleWatch(video.jobId)}
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
                    disabled={!!loadingAction[video.jobId]}
                    onClick={() => handleDownload(video.jobId, video.title || video.prompt)}
                  >
                    {loadingAction[video.jobId] === "download"
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <Download className="h-3.5 w-3.5" />}
                  </Button>

                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive">
                        <Trash2 className="h-3.5 w-3.5" />
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
              </div>
            </motion.div>
          ))}
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
      )}
    </div>
  );
}
