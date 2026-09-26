import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { buildAuthUrl } from "@/lib/authIntent";
import { useCreateImagePack, useGetDashboardStats, getGetDashboardStatsQueryKey, usePlanImagePack, VideoStyle, type ImagePackScene } from "@workspace/api-client-react";
import { analyzeNumberedScenes } from "@/lib/imageCreation";
import { isImagePackPlanValid, updateImagePackScenePrompt, MAX_IMAGE_PACK_SCENE_PROMPT_LENGTH } from "@/lib/imagePackReview";
import { MAX_CREATIVE_PROMPT_LENGTH } from "@/lib/scenePromptScript";
import { GENERATED_IMAGE_CREDITS_PER_VISUAL } from "@/lib/creditPricing";
import { AMELIA_EARHART_MONTAGE_EXAMPLE } from "@/lib/montageExamples";
import { trackEvent } from "@/lib/analytics";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Loader2, ImageIcon } from "lucide-react";

const STYLES = [
  ["realistic", "Realistic"], ["anime", "Anime"], ["cinematic", "Cinematic"],
  ["abstract", "Abstract"], ["neon", "Neon Glow"], ["vintage", "Vintage"],
  ["fantasy", "Fantasy"], ["documentary", "Docu-style"],
] as const;

type GalleryReference = { id: string; objectPath: string; prompt?: string };

export default function CreateImages() {
  const [, navigate] = useLocation();
  const { isAuthenticated, isLoading: authLoading, user } = useAuth();
  const params = new URLSearchParams(window.location.search);
  const [prompt, setPrompt] = useState(params.get("prompt") ?? params.get("script") ?? "");
  const [count, setCount] = useState(Number(params.get("count") ?? params.get("imageCount") ?? 4));
  const [style, setStyle] = useState<VideoStyle>(
    Object.values(VideoStyle).includes(params.get("style") as VideoStyle)
      ? params.get("style") as VideoStyle : VideoStyle.cinematic,
  );
  const [ratio, setRatio] = useState<"9:16" | "16:9">(params.get("aspectRatio") === "16:9" ? "16:9" : "9:16");
  const [referencePath, setReferencePath] = useState(params.get("referenceImagePath") ?? "");
  const [referencePreview, setReferencePreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [error, setError] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [scenes, setScenes] = useState<ImagePackScene[] | null>(null);
  const requestId = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const plan = usePlanImagePack();
  const create = useCreateImagePack();
  const { data: stats } = useGetDashboardStats({ query: { queryKey: getGetDashboardStatsQueryKey(), enabled: isAuthenticated } });
  const gallery = useQuery({
    queryKey: ["image-reference-picker"],
    enabled: galleryOpen && isAuthenticated,
    queryFn: async () => {
      const response = await fetch("/api/image-assets?page=1&limit=50", { credentials: "include" });
      if (!response.ok) throw new Error("Could not load gallery images.");
      return (await response.json() as { assets: GalleryReference[] }).assets;
    },
  });
  const analysis = analyzeNumberedScenes(prompt, 30);
  const imageCount = analysis.count ?? count;
  const price = imageCount * GENERATED_IMAGE_CREDITS_PER_VISUAL;
  const balance = stats?.creditsRemaining;

  useEffect(() => {
    requestId.current++;
    setScenes(null);
  }, [prompt, count, style, ratio, referencePath]);

  useEffect(() => {
    return () => { if (referencePreview?.startsWith("blob:")) URL.revokeObjectURL(referencePreview); };
  }, [referencePreview]);

  async function uploadReference(file: File) {
    setError("");
    setUploading(true);
    setReferencePath("");
    setReferencePreview(URL.createObjectURL(file));
    try {
      const response = await fetch("/api/storage/uploads/request-url", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
      });
      if (!response.ok) throw new Error("Could not request an image upload URL.");
      const data = await response.json() as { uploadURL: string; objectPath: string };
      const put = await fetch(data.uploadURL, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      if (!put.ok) throw new Error(`Image upload failed (${put.status}).`);
      setReferencePath(data.objectPath);
    } catch (cause) {
      setReferencePreview(null);
      setError(cause instanceof Error ? cause.message : "Image upload failed.");
    } finally {
      setUploading(false);
    }
  }

  function validate() {
    if (!prompt.trim()) return "Describe the images you want to create.";
    if (prompt.length > MAX_CREATIVE_PROMPT_LENGTH) return `Shorten your prompt to ${MAX_CREATIVE_PROMPT_LENGTH.toLocaleString()} characters or fewer.`;
    if (analysis.invalid) return "Number every scene consecutively from 1, with one complete scene on each line (up to 30).";
    if (!Number.isInteger(imageCount) || imageCount < 1 || imageCount > 30) return "Choose between 1 and 30 images.";
    if (uploading) return "Wait for the reference image to finish uploading.";
    return "";
  }

  function review() {
    const message = validate();
    if (message) { setError(message); return; }
    if (!isAuthenticated) {
      navigate(buildAuthUrl("/login", { returnTo: `/images${window.location.search}` }));
      return;
    }
    if (balance !== undefined && balance < price && !user?.isAdmin) {
      setError(`Not enough credits: ${price} required, ${balance} available. Add credits before creating images.`);
      return;
    }
    setError("");
    setReviewOpen(true);
    const id = ++requestId.current;
    plan.mutate({
      data: { prompt: prompt.trim(), style, imageCount, aspectRatio: ratio, referenceImagePath: referencePath || null },
    }, {
      onSuccess: (result) => { if (id === requestId.current) setScenes(result.scenes); },
      onError: (cause) => {
        if (id !== requestId.current) return;
        setReviewOpen(false);
        setError((cause as { data?: { error?: string } }).data?.error ?? (cause as Error).message ?? "Could not plan image scenes.");
      },
    });
  }

  function submit() {
    if (!isImagePackPlanValid(scenes, imageCount) || create.isPending) return;
    const message = validate();
    if (message) { setError(message); setReviewOpen(false); return; }
    setError("");
    trackEvent("creation_started", { creation_type: "image_pack", image_count: imageCount });
    create.mutate({
      data: { prompt: prompt.trim(), style, imageCount, aspectRatio: ratio, referenceImagePath: referencePath || null, approvedScenes: scenes ?? undefined },
    }, {
      onSuccess: (job) => {
        trackEvent("creation_accepted", { creation_type: "image_pack" });
        navigate(`/jobs/${job.id}`);
      },
      onError: (cause) => {
        setReviewOpen(false);
        const err = cause as { data?: { error?: string }; response?: { data?: { error?: string } }; message?: string };
        setError(err.data?.error ?? err.response?.data?.error ?? err.message ?? "Could not create images. Please try again.");
      },
    });
  }

  if (authLoading) return <div className="flex justify-center py-20"><Loader2 className="animate-spin" /></div>;
  return (
    <div className="container mx-auto max-w-4xl px-4 py-8 sm:py-12">
      <h1 className="text-3xl font-bold">Create Images</h1>
      <p className="mt-2 text-muted-foreground">Generate standalone images for your gallery and Montage Studio. No audio or video render needed.</p>
      <div className="mt-5 flex flex-wrap gap-3 text-sm">
        <Link href="/generate" className="inline-flex min-h-11 items-center text-primary underline">Generate Video</Link>
        <Link href="/gallery?view=images" className="inline-flex min-h-11 items-center text-primary underline">View image gallery</Link>
      </div>
      <div className="mt-8 space-y-6 rounded-2xl border border-border bg-card p-4 sm:p-8">
        <div className="space-y-2">
          <Label htmlFor="image-prompt">Prompt or numbered scene script</Label>
          <Textarea id="image-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={MAX_CREATIVE_PROMPT_LENGTH + 1} className="min-h-40" placeholder="Describe the images you want, or write 1. First scene&#10;2. Second scene..." />
          <p className="text-xs text-muted-foreground">A numbered script creates one image per scene in order. Up to 30 images.</p>
          <Button type="button" variant="outline" className="min-h-11 whitespace-normal h-auto text-left" onClick={() => { setPrompt(AMELIA_EARHART_MONTAGE_EXAMPLE); setCount(21); setStyle(VideoStyle.documentary); setRatio("16:9"); }}>
            Try Amelia Earhart example
          </Button>
        </div>
        <div className="grid gap-5 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="image-count">Images to generate</Label>
            <Input id="image-count" type="number" min={1} max={30} value={imageCount} disabled={analysis.count !== null} onChange={(e) => setCount(Number(e.target.value))} className="min-h-11" />
            {analysis.count !== null && <p className="text-xs text-muted-foreground">{analysis.count} scenes detected</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="image-style">Style</Label>
            <select id="image-style" className="flex min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm" value={style} onChange={(e) => setStyle(e.target.value as VideoStyle)}>
              {STYLES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="image-ratio">Image size</Label>
            <select id="image-ratio" className="flex min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm" value={ratio} onChange={(e) => setRatio(e.target.value as "9:16" | "16:9")}>
              <option value="9:16">Portrait · 9:16</option><option value="16:9">Landscape · 16:9</option>
            </select>
          </div>
        </div>
        <div className="space-y-3">
          <Label>Reference image (optional)</Label>
          <p className="text-xs text-muted-foreground">Keep your subject consistent across the pack. Upload one or reuse an image from your gallery.</p>
          <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) void uploadReference(file); e.target.value = ""; }} />
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" className="min-h-11" onClick={() => inputRef.current?.click()} disabled={uploading}>Upload reference</Button>
            <Button type="button" variant="outline" className="min-h-11" onClick={() => setGalleryOpen((value) => !value)}>Choose from gallery</Button>
            {referencePath && <Button type="button" variant="ghost" className="min-h-11" onClick={() => { setReferencePath(""); setReferencePreview(null); }}>Remove reference</Button>}
          </div>
          {uploading && <p role="status">Uploading reference…</p>}
          {referencePath && <div className="flex items-center gap-3 text-sm"><img className="h-16 w-16 rounded object-cover" src={referencePreview ?? `/api/storage${referencePath}`} alt="Selected reference" />Reference ready</div>}
          {galleryOpen && <div className="rounded-lg border p-3">
            {gallery.isLoading ? <p>Loading images…</p> : gallery.isError ? <p role="alert">{(gallery.error as Error).message}</p> : gallery.data?.length ? (
              <div className="grid max-h-64 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-6">
                {gallery.data.map((asset) => <button key={asset.id} type="button" className="min-h-11 rounded border focus-visible:ring-2 focus-visible:ring-primary" aria-label={`Use image ${asset.prompt || asset.id} as reference`} onClick={() => { setReferencePath(asset.objectPath); setReferencePreview(null); setGalleryOpen(false); }}>
                  <img src={`/api/storage${asset.objectPath}`} alt={asset.prompt || "Gallery image"} className="aspect-square w-full object-cover" />
                </button>)}
              </div>
            ) : <p>No saved images yet.</p>}
          </div>}
        </div>
        <div className="rounded-lg border border-primary/25 bg-primary/5 p-4 text-sm">
          <strong>{price} credits</strong> · {GENERATED_IMAGE_CREDITS_PER_VISUAL} credits per image. Failed images are refunded.
          {balance !== undefined && <span className="block">You have {balance} credits.</span>}
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error} {error.startsWith("Not enough credits") && <Link href="/pricing" className="underline">View plans</Link>}</p>}
        <Button type="button" onClick={review} disabled={uploading || plan.isPending} className="min-h-11 w-full sm:w-auto">
          {plan.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImageIcon className="mr-2 h-4 w-4" />} Review Image Pack
        </Button>
      </div>
      <Dialog open={reviewOpen} onOpenChange={(open) => { if (!open) requestId.current++; setReviewOpen(open); }}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader><DialogTitle>Confirm Image Pack</DialogTitle><DialogDescription>Review and edit every scene before spending credits. Planning is free. Your images will appear in the gallery after the job completes.</DialogDescription></DialogHeader>
          <p className="text-sm">{imageCount} images · {ratio} · {price} credits</p>
          {plan.isPending && !scenes ? <p role="status" className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Planning scenes…</p> : (
            <div className="max-h-72 space-y-3 overflow-y-auto">
              {scenes?.map((scene) => <div key={scene.index} className="space-y-1"><Label htmlFor={`scene-${scene.index}`}>Scene {scene.index + 1}</Label><Textarea id={`scene-${scene.index}`} value={scene.prompt} maxLength={MAX_IMAGE_PACK_SCENE_PROMPT_LENGTH} onChange={(e) => setScenes((current) => current ? updateImagePackScenePrompt(current, scene.index, e.target.value) : current)} /></div>)}
            </div>
          )}
          <DialogFooter><Button className="min-h-11 w-full sm:w-auto" disabled={!isImagePackPlanValid(scenes, imageCount) || create.isPending} onClick={submit}>{create.isPending ? "Creating…" : "Confirm & Generate Images"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}