import { useEffect } from "react";
import { useLocation, Link } from "wouter";
import { useAuth } from "@workspace/replit-auth-web";
import { useListVideos, useDeleteVideo, getListVideosQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Loader2, Trash2, Play, Film } from "lucide-react";
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

export default function Gallery() {
  const [, setLocation] = useLocation();
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const queryClient = useQueryClient();
  
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
    <div className="container mx-auto px-4 py-12 max-w-7xl">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-10 gap-4">
        <div>
          <h1 className="text-4xl font-bold tracking-tight">Your Gallery</h1>
          <p className="text-muted-foreground mt-1">All your generated AI music videos.</p>
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
              <div className="aspect-video bg-muted relative overflow-hidden flex items-center justify-center">
                {video.thumbnailObjectPath ? (
                  <img 
                    src={`/api/storage${video.thumbnailObjectPath}`} 
                    alt={video.title || "Video thumbnail"}
                    className="object-cover w-full h-full"
                  />
                ) : (
                  <Film className="h-12 w-12 text-muted-foreground/30" />
                )}
                
                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <a href={`/api/storage${video.videoObjectPath}`} target="_blank" rel="noopener noreferrer">
                    <Button size="icon" className="h-12 w-12 rounded-full bg-primary text-white hover:bg-primary hover:scale-110 transition-all">
                      <Play className="h-6 w-6 ml-1" />
                    </Button>
                  </a>
                </div>
                
                {video.durationSeconds && (
                  <div className="absolute bottom-2 right-2 bg-black/80 px-2 py-1 rounded text-xs font-medium text-white backdrop-blur-sm">
                    {Math.floor(video.durationSeconds / 60)}:{(video.durationSeconds % 60).toString().padStart(2, '0')}
                  </div>
                )}
              </div>
              
              <div className="p-4 flex-1 flex flex-col">
                <h3 className="font-semibold text-lg line-clamp-1 mb-1" title={video.prompt || video.title || "Untitled"}>
                  {video.title || video.prompt || "Untitled"}
                </h3>
                
                <div className="flex items-center justify-between mt-auto pt-4">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium px-2 py-1 rounded-md bg-secondary text-secondary-foreground capitalize">
                      {video.style}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(video.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive">
                        <Trash2 className="h-4 w-4" />
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
                          onClick={() => deleteVideo.mutate({ query: { id: video.id } })}
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
        <div className="text-center py-32 border border-dashed border-border rounded-2xl bg-card/30">
          <Film className="h-16 w-16 text-muted-foreground mx-auto mb-6 opacity-20" />
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
