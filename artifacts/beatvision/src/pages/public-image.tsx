import { useParams, Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { useGetPublicImageAsset, getGetPublicImageAssetQueryKey, useLikeImageAsset, useUnlikeImageAsset } from "@workspace/api-client-react";
import { useSEO } from "@/hooks/useSEO";
import { Button } from "@/components/ui/button";
import { Heart, Loader2, Share2, Scissors, Image as ImageIcon, Sparkles, BookOpen } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

export default function PublicImageDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { isAuthenticated } = useAuth();
  const queryClient = useQueryClient();

  const { data: asset, isLoading, isError } = useGetPublicImageAsset(id || "", {
    query: { enabled: !!id, queryKey: getGetPublicImageAssetQueryKey(id || "") }
  });

  const [shareFeedback, setShareFeedback] = useState("");

  useSEO({
    title: asset ? `AI Generated Image by ${asset.creatorName || "Anonymous"}` : "AI Generated Image",
    description: "Check out this AI-generated image created with AIBeatSync. Remix it to create your own music video.",
    canonical: `/image/${id}`,
    ogImage: asset ? `https://aibeatsync.com/api/storage${asset.objectPath}` : undefined,
  });

  const likeImageAsset = useLikeImageAsset();
  const unlikeImageAsset = useUnlikeImageAsset();

  async function handleLike() {
    if (!isAuthenticated) {
      setLocation("/login");
      return;
    }
    if (!asset) return;

    const currentlyLiked = asset.liked;

    // Optimistic update
    queryClient.setQueryData(
      getGetPublicImageAssetQueryKey(asset.id),
      (oldData: any) => {
        if (!oldData) return oldData;
        return {
          ...oldData,
          liked: !currentlyLiked,
          likeCount: oldData.likeCount + (currentlyLiked ? -1 : 1)
        };
      }
    );

    try {
      if (currentlyLiked) {
        await unlikeImageAsset.mutateAsync({ id: asset.id });
      } else {
        await likeImageAsset.mutateAsync({ id: asset.id });
      }
    } catch {
      queryClient.invalidateQueries({ queryKey: getGetPublicImageAssetQueryKey(asset.id) });
    }
  }

  async function handleShare() {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: "AI Generated Image", url });
      } catch (err) {
        // ignore
      }
    } else {
      await navigator.clipboard.writeText(url);
      setShareFeedback("Copied!");
      setTimeout(() => setShareFeedback(""), 2000);
    }
  }

  function openRemixLab() {
    setLocation("/editor");
  }

  if (isLoading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (isError || !asset) {
    return (
      <div className="container mx-auto px-4 py-24 text-center">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-muted">
          <ImageIcon className="h-10 w-10 text-muted-foreground" />
        </div>
        <h1 className="mt-6 text-2xl font-bold">Image not found</h1>
        <p className="mt-2 text-muted-foreground">This image may have been deleted or made private by its creator.</p>
        <Link href="/explore">
          <Button className="mt-8 bg-gradient-electric text-white shadow-glow">
            Browse Explore
          </Button>
        </Link>
      </div>
    );
  }

  const initial = (asset.creatorName || "A").trim().charAt(0).toUpperCase();

  return (
    <div className="container mx-auto max-w-6xl px-4 py-8 sm:py-12">
      <Link href="/explore" className="mb-6 inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground">
        ← Back to Explore
      </Link>
      
      <div className="grid gap-8 lg:grid-cols-3">
        {/* Left Col: The Image */}
        <div className="lg:col-span-2">
          <div className="overflow-hidden rounded-2xl border border-border bg-muted relative">
            <img 
              src={`/api/storage${asset.objectPath}`} 
              alt={`AI generated image by ${asset.creatorName || "anonymous creator"}`} 
              className="w-full h-auto object-contain max-h-[80vh] mx-auto"
            />
          </div>
        </div>

        {/* Right Col: Details and CTAs */}
        <div className="flex flex-col gap-6">
          <div className="rounded-xl border border-card-border bg-card p-6 shadow-sm">
            <div className="flex items-center gap-3 border-b border-border pb-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-lg font-semibold text-primary">
                {initial}
              </div>
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-lg font-bold">Generated Image</h1>
                <p className="text-sm text-muted-foreground">by {asset.creatorName || "Anonymous"}</p>
              </div>
            </div>

            <div className="flex items-center justify-between py-4">
              <div className="flex items-center gap-4">
                <button
                  onClick={handleLike}
                  className={`flex items-center gap-1.5 text-sm font-medium transition-colors ${
                    asset.liked ? "text-primary" : "text-muted-foreground hover:text-foreground"
                  }`}
                  title={asset.liked ? "Unlike image" : "Like image"}
                  aria-label={asset.liked ? "Unlike image" : "Like image"}
                  data-testid={`like-btn-${asset.id}`}
                >
                  <Heart className={`h-5 w-5 ${asset.liked ? "fill-current" : ""}`} />
                  {asset.likeCount}
                </button>
                <button
                  onClick={handleShare}
                  className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                  title="Share image link"
                  aria-label="Share image link"
                  data-testid={`share-btn-${asset.id}`}
                >
                  <Share2 className="h-5 w-5" />
                  {shareFeedback || "Share"}
                </button>
              </div>
              <div className="text-xs text-muted-foreground font-medium bg-muted px-2 py-1 rounded-md">
                {new Date(asset.createdAt).toLocaleDateString()}
              </div>
            </div>

            {asset.style && (
              <div className="pb-4">
                <span className="inline-flex items-center rounded-full bg-secondary px-2.5 py-0.5 text-xs font-semibold text-secondary-foreground capitalize">
                  {asset.style} style
                </span>
              </div>
            )}
            
            <p className="text-xs text-muted-foreground italic mb-2 border-t border-border pt-4">
              Prompts are kept private to protect the creator's creative process.
            </p>
          </div>

          <div className="rounded-xl border border-primary/20 bg-primary/5 p-6 shadow-glow">
            <h2 className="text-lg font-bold mb-2">Inspired by this image?</h2>
            <p className="text-sm text-muted-foreground mb-6">
              Generate your own image sequence, then arrange it into a finished video in Remix Lab.
            </p>
            
            <div className="flex flex-col gap-3">
              <Button 
                onClick={openRemixLab}
                className="w-full bg-gradient-electric text-white shadow-glow justify-start"
                data-testid={`remix-btn-${asset.id}`}
              >
                <Scissors className="mr-2 h-4 w-4" />
                Open Remix Lab
              </Button>
              
              <Link href="/generate">
                <Button variant="outline" className="w-full justify-start bg-background hover:bg-muted">
                  <Sparkles className="mr-2 h-4 w-4 text-primary" />
                  Generate Your Own
                </Button>
              </Link>
              
              <Link href="/tutorial/script-to-video">
                <Button variant="ghost" className="w-full justify-start text-muted-foreground hover:text-foreground">
                  <BookOpen className="mr-2 h-4 w-4" />
                  Learn how it works
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
