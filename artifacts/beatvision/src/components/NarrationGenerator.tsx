import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Loader2, Play, Square, AlertCircle, Download, CheckCircle2, Music, Upload, MonitorPlay, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { SoundtrackPickerDialog, type PickedSoundtrack } from "./SoundtrackPickerDialog";
import {
  useNarrationVoices,
  useEstimateNarration,
  useCreateNarration,
  useNarrationJob,
  useSaveNarrationToSoundtracks,
  isNarrationGenerating,
  type NarrationResultHandoff,
  type NarrationJob
} from "@/hooks/use-narration";

interface NarrationGeneratorProps {
  onHandoff: (handoff: NarrationResultHandoff, title: string) => void;
  onExit: () => void;
  onCostError?: (error: any) => void;
}

export function NarrationGenerator({ onHandoff, onExit, onCostError }: NarrationGeneratorProps) {
  const { toast } = useToast();
  const { isAuthenticated } = useAuth();

  const [script, setScript] = useState("");
  const [voiceId, setVoiceId] = useState<string>("");

  // Music State
  const [musicSource, setMusicSource] = useState<"none" | "generated" | "soundtrack" | "upload" | "suno">("none");
  const [musicPrompt, setMusicPrompt] = useState("");
  const [soundtrackId, setSoundtrackId] = useState<string | undefined>();
  const [musicObjectPath, setMusicObjectPath] = useState<string | undefined>();
  const [musicPreviewUrl, setMusicPreviewUrl] = useState<string | undefined>();
  const [musicTitle, setMusicTitle] = useState<string | undefined>();
  const [sunoInputUrl, setSunoInputUrl] = useState("");
  const [isImportingSuno, setIsImportingSuno] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: voicesData, isLoading: voicesLoading } = useNarrationVoices();

  useEffect(() => {
    if (voicesData?.defaultVoiceId && !voiceId) {
      setVoiceId(voicesData.defaultVoiceId);
    }
  }, [voicesData, voiceId]);

  const [activeJobId, setActiveJobId] = useState<string | null>(() => {
    return localStorage.getItem("bv-active-narration-id");
  });

  useEffect(() => {
    if (!isAuthenticated) {
      setActiveJobId(null);
      localStorage.removeItem("bv-active-narration-id");
    }
  }, [isAuthenticated]);

  const { data: jobData, error: jobError, isLoading: jobLoading } = useNarrationJob(activeJobId);
  const job = jobData?.narration;

  const estimateMutation = useEstimateNarration();
  const createMutation = useCreateNarration();
  const saveToSoundtracksMutation = useSaveNarrationToSoundtracks();
  const [savedToSoundtracks, setSavedToSoundtracks] = useState(false);
  const [videoReviewConfirmed, setVideoReviewConfirmed] = useState(false);
  useEffect(() => {
    setSavedToSoundtracks(false);
    setVideoReviewConfirmed(false);
  }, [activeJobId]);

  const [debouncedScript, setDebouncedScript] = useState(script);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedScript(script), 500);
    return () => clearTimeout(timer);
  }, [script]);


  const isSelectionComplete = () => {
    if (musicSource === "soundtrack" && !soundtrackId) return false;
    if (["upload", "suno"].includes(musicSource) && !musicObjectPath) return false;
    return true;
  };

  useEffect(() => {
    if (debouncedScript.length >= 40) {
      if (isSelectionComplete()) {
        estimateMutation.mutate({
          script: debouncedScript,
          voiceId,
          musicSource,
          musicPrompt: musicSource === "generated" ? musicPrompt : undefined,
          soundtrackId: musicSource === "soundtrack" ? soundtrackId : undefined,
          musicObjectPath: ["upload", "suno", "soundtrack"].includes(musicSource) ? musicObjectPath : undefined,
          musicTitle: ["upload", "suno", "soundtrack"].includes(musicSource) ? musicTitle : undefined,
        });
      } else {
        estimateMutation.reset();
      }
    } else {
      estimateMutation.reset();
    }
  }, [debouncedScript, voiceId, musicSource, musicPrompt, soundtrackId, musicObjectPath, musicTitle]);


  const [playingPreview, setPlayingPreview] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const togglePreview = (id: string, path: string) => {
    if (playingPreview === id) {
      audioRef.current?.pause();
      setPlayingPreview(null);
    } else {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      const audio = new Audio(path);
      audio.onended = () => setPlayingPreview(null);
      audio.play().catch(() => {
        toast({ title: "Preview failed", description: "Could not play voice preview.", variant: "destructive" });
        setPlayingPreview(null);
      });
      audioRef.current = audio;
      setPlayingPreview(id);
    }
  };
  
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
      }
    };
  }, []);

  const handleGenerate = () => {
    if (script.length < 40) {
      toast({ title: "Script too short", description: "Please enter at least 40 characters.", variant: "destructive" });
      return;
    }

    if (musicSource === "soundtrack" && !soundtrackId) {
      toast({ title: "Music missing", description: "Please select music.", variant: "destructive" });
      return;
    }

    if ((musicSource === "upload" || musicSource === "suno") && !musicObjectPath) {
      toast({ title: "Music missing", description: "Please provide an audio track.", variant: "destructive" });
      return;
    }

    const idempotencyKey = crypto.randomUUID();
    createMutation.mutate(
      {
        script,
        voiceId,
        musicSource,
        musicPrompt: musicSource === "generated" ? musicPrompt : undefined,
        soundtrackId,
        musicObjectPath,
        musicTitle,
        idempotencyKey
      },
      {
        onSuccess: (data) => {
          setActiveJobId(data.narration.id);
          localStorage.setItem("bv-active-narration-id", data.narration.id);
        },
        onError: (error: any) => {
          if (error.code === "INSUFFICIENT_CREDITS" || error.code === "SUBSCRIPTION_REQUIRED") {
            onCostError?.(error);
          } else {
            toast({ title: "Narration failed", description: error.message || "Failed to start narration", variant: "destructive" });
          }
        }
      }
    );
  };

  const handleHandoff = () => {
    if (!videoReviewConfirmed) {
      toast({
        title: "Review the narration first",
        description: "Listen to the completed audio and confirm it is ready before continuing to video setup.",
        variant: "destructive",
      });
      return;
    }
    if (job?.result?.handoff) {
      onHandoff(job.result.handoff, "AI Narration");
    }
  };

  const handleAudioOnly = () => {
    if (!job?.id) return;
    saveToSoundtracksMutation.mutate(job.id, {
      onSuccess: () => {
        setSavedToSoundtracks(true);
        toast({
          title: "Saved to My Music",
          description: "Your narration is now available in My Music.",
        });
      },
      onError: (error) => {
        toast({
          title: "Could not save narration",
          description: error.message,
          variant: "destructive",
        });
      },
    });
  };

  const handleSunoImport = async () => {
    if (!sunoInputUrl) return;
    setIsImportingSuno(true);
    try {
      const res = await fetch("/api/audio/import-from-link", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: sunoInputUrl })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to import Suno link");

      setMusicObjectPath(data.objectPath);
      setMusicPreviewUrl(data.url);
      setMusicTitle(data.title);
      toast({ title: "Import successful", description: `Loaded "${data.title}"` });
    } catch (err: any) {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    } finally {
      setIsImportingSuno(false);
    }
  };

  const handleFileUpload = async (file: File) => {
    if (!file) return;
    setIsUploading(true);
    try {
      const extension = file.name.toLowerCase().split(".").pop() ?? "";
      const contentType = file.type && file.type !== "application/octet-stream"
        ? file.type
        : extension === "mp3" ? "audio/mpeg" : extension === "wav" ? "audio/wav" : "application/octet-stream";

      const res = await fetch("/api/storage/uploads/request-url", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, size: file.size, contentType }),
      });
      if (!res.ok) throw new Error("Failed to get upload URL");
      const data = await res.json();

      const putRes = await fetch(data.uploadURL, {
        method: "PUT",
        headers: { "Content-Type": contentType },
        body: file,
      });
      if (!putRes.ok) throw new Error("Storage upload failed");

      setMusicObjectPath(data.objectPath);
      setMusicTitle(file.name);
      setMusicPreviewUrl(URL.createObjectURL(file));

      // Request audio analysis asynchronously so the backend knows about the upload
      fetch("/api/audio/analyze", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ objectPath: data.objectPath })
      }).catch(console.error);

    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const clearMusicSelection = () => {
    setMusicObjectPath(undefined);
    setSoundtrackId(undefined);
    setMusicPreviewUrl(undefined);
    setMusicTitle(undefined);
    setSunoInputUrl("");
  };

  const isGenerating = isNarrationGenerating(job?.status);
  
  if (activeJobId && jobLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4 space-y-6 bg-card border rounded-lg">
        <Loader2 className="w-10 h-10 animate-spin text-primary" />
        <div className="text-center space-y-2">
          <h3 className="text-lg font-medium">Loading Narration</h3>
          <p className="text-sm text-muted-foreground">Recovering your session...</p>
        </div>
      </div>
    );
  }

  if (jobError) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4 space-y-6 bg-destructive/10 border border-destructive/20 rounded-lg text-center">
        <AlertCircle className="w-10 h-10 text-destructive" />
        <div className="space-y-2">
          <h3 className="text-lg font-medium text-destructive">Could Not Load Narration</h3>
          <p className="text-sm text-muted-foreground">{jobError.message || "Failed to retrieve narration status."}</p>
        </div>
        <Button onClick={() => {
          setActiveJobId(null);
          localStorage.removeItem("bv-active-narration-id");
        }} variant="outline">
          Start Over
        </Button>
      </div>
    );
  }

  if (isGenerating && job) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4 space-y-6 bg-card border rounded-lg">
        <Loader2 className="w-10 h-10 animate-spin text-primary" />
        <div className="text-center space-y-2">
          <h3 className="text-lg font-medium">Synthesizing Narration</h3>
          <p className="text-sm text-muted-foreground">
            {job.status === "queued" ? "Waiting in queue..." : 
             job.status === "analyzing" ? "Analyzing script..." : 
             job.status === "stitching" ? "Finalizing audio..." :
             "Generating audio..."}
          </p>
        </div>
        {job.progressPercent > 0 && (
          <div className="w-full max-w-md h-2 bg-secondary rounded-full overflow-hidden">
            <div 
              className="h-full bg-primary transition-all duration-500 ease-out" 
              style={{ width: `${job.progressPercent}%` }} 
            />
          </div>
        )}
      </div>
    );
  }

  if (job?.status === "ready") {
    return (
      <div className="flex flex-col py-8 px-6 space-y-6 bg-card border rounded-lg">
        <div className="flex items-center gap-3 text-green-500 mb-2">
          <CheckCircle2 className="w-6 h-6" />
          <h3 className="text-lg font-medium text-foreground">Narration Ready</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Listen to the completed narration below. When you are satisfied with it, confirm your review before continuing to video setup.
        </p>
        <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-sm">
          <span className="font-medium text-foreground">
            Narration audio charged: {job.chargedCost} credit{job.chargedCost === 1 ? "" : "s"}
          </span>
          <span className="mt-1 block text-xs text-muted-foreground">
            Audio Only adds no further charge. Use in Video opens a separate video estimate before any video credits are charged.
          </span>
        </div>
        
        <div className="flex flex-col gap-4">
          <audio controls src={job.result?.downloadPath} className="w-full" />

          <div className="flex items-start gap-3 rounded-md border border-border/60 bg-muted/20 p-3">
            <Checkbox
              id="confirm-narration-review"
              checked={videoReviewConfirmed}
              onCheckedChange={(checked) => setVideoReviewConfirmed(checked === true)}
            />
            <Label htmlFor="confirm-narration-review" className="cursor-pointer text-sm leading-5">
              I reviewed the completed narration and want to use this audio in a video.
            </Label>
          </div>
          
          <div className="grid gap-3 mt-4 sm:grid-cols-2">
            <Button
              variant="outline"
              className="w-full"
              onClick={handleAudioOnly}
              disabled={saveToSoundtracksMutation.isPending || savedToSoundtracks}
            >
              {saveToSoundtracksMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : savedToSoundtracks ? (
                <CheckCircle2 className="w-4 h-4 mr-2" />
              ) : (
                <Download className="w-4 h-4 mr-2" />
              )}
              {savedToSoundtracks ? "Saved to My Music" : "Audio Only · Save to My Music"}
            </Button>
            <Button
              onClick={handleHandoff}
              disabled={!videoReviewConfirmed}
              className="w-full font-medium shadow-glow"
            >
              Continue to Video Setup
            </Button>
          </div>
          {savedToSoundtracks && (
            <div className="flex justify-center">
              <Button variant="link" size="sm" asChild>
                <a href={job.result?.downloadPath} download>
                  Download Audio File
                </a>
              </Button>
            </div>
          )}
          <div className="flex justify-center">
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button variant="ghost" size="sm" onClick={onExit}>
                Exit Without Video
              </Button>
              <Button variant="ghost" size="sm" onClick={() => {
                setActiveJobId(null);
                localStorage.removeItem("bv-active-narration-id");
              }}>
                Create New Narration
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }
  
  if (job?.status === "failed") {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4 space-y-6 bg-destructive/10 border border-destructive/20 rounded-lg text-center">
        <AlertCircle className="w-10 h-10 text-destructive" />
        <div className="space-y-2">
          <h3 className="text-lg font-medium text-destructive">Generation Failed</h3>
          <p className="text-sm text-muted-foreground">{job.error || "An unknown error occurred."}</p>
          {job.refunded && (
            <p className="text-sm font-medium text-muted-foreground mt-2">Credits have been refunded to your account.</p>
          )}
        </div>
        <Button onClick={() => {
          setActiveJobId(null);
          localStorage.removeItem("bv-active-narration-id");
        }} variant="outline">
          Try Again
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 bg-card border rounded-lg p-6">
      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <Label htmlFor="script" className="text-base">Script</Label>
          <span className="text-xs text-muted-foreground">
            {script.length} / 39,000
          </span>
        </div>
        <Textarea
          id="script"
          value={script}
          onChange={e => setScript(e.target.value)}
          placeholder="Enter the text you want narrated..."
          className="min-h-[120px] resize-y"
          maxLength={39000}
        />
        {script.length > 0 && script.length < 40 && (
          <p className="text-xs text-destructive">Script must be at least 40 characters.</p>
        )}
      </div>

      <div className="space-y-3">
        <Label>Voice</Label>
        <div className="flex gap-2 max-w-md">
          <Select value={voiceId} onValueChange={setVoiceId} disabled={voicesLoading}>
            <SelectTrigger className="flex-1">
              <SelectValue placeholder="Select a voice" />
            </SelectTrigger>
            <SelectContent>
              {voicesData?.voices.map(v => (
                <SelectItem key={v.id} value={v.id}>
                  {v.label} {v.isDefault && "(Default)"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {voiceId && voicesData && (
            <Button
              variant="outline"
              size="icon"
              onClick={() => {
                const voice = voicesData.voices.find(v => v.id === voiceId);
                if (voice) togglePreview(voice.id, voice.previewPath);
              }}
            >
              {playingPreview === voiceId ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-4 pt-4 border-t">
        <Label className="text-base">Background Music</Label>
        <Tabs value={musicSource} onValueChange={(v: any) => { setMusicSource(v); clearMusicSelection(); }}>
          <TabsList className="grid grid-cols-5 w-full">
            <TabsTrigger value="none">None</TabsTrigger>
            <TabsTrigger value="generated">Generate</TabsTrigger>
            <TabsTrigger value="soundtrack">My Music</TabsTrigger>
            <TabsTrigger value="upload">Upload</TabsTrigger>
            <TabsTrigger value="suno">Suno</TabsTrigger>
          </TabsList>

          <div className="mt-4">
            <TabsContent value="none" className="text-sm text-muted-foreground bg-muted/40 p-3 rounded-md">
              Voice only. No background music will be added.
            </TabsContent>

            <TabsContent value="generated" className="space-y-3">
              <div className="bg-primary/5 text-primary text-sm p-3 rounded-md mb-2">
                AI-generated music bed included — no separate music charge
              </div>
              <Label>Music Prompt (Optional)</Label>
              <Input
                value={musicPrompt}
                onChange={e => setMusicPrompt(e.target.value)}
                placeholder="e.g. gentle acoustic guitar, ambient lofi..."
                maxLength={300}
              />
            </TabsContent>

            <TabsContent value="soundtrack">
              {musicObjectPath && musicTitle && musicSource === "soundtrack" ? (
                <div className="border border-primary/20 bg-primary/5 p-4 rounded-lg flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <Music className="w-5 h-5 text-primary shrink-0" />
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{musicTitle}</p>
                      <p className="text-xs text-muted-foreground">My Music</p>
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" onClick={clearMusicSelection}>
                    <Trash2 className="w-4 h-4 text-muted-foreground" />
                  </Button>
                </div>
              ) : (
                <div className="flex justify-center p-6 border rounded-lg border-dashed bg-muted/20">
                  <SoundtrackPickerDialog onSelect={(t) => {
                    setSoundtrackId((t as any).id); // Ensure soundtrack ID is set if it's there
                    setMusicObjectPath(t.objectPath);
                    setMusicPreviewUrl(t.url);
                    setMusicTitle(t.title);
                  }}>
                    <Button variant="outline" className="shadow-sm">
                      <Music className="w-4 h-4 mr-2 text-primary" /> Select from My Music
                    </Button>
                  </SoundtrackPickerDialog>
                </div>
              )}
            </TabsContent>

            <TabsContent value="upload">
              {musicObjectPath && musicTitle && musicSource === "upload" ? (
                <div className="border border-primary/20 bg-primary/5 p-4 rounded-lg flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <CheckCircle2 className="w-5 h-5 text-primary shrink-0" />
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{musicTitle}</p>
                      <p className="text-xs text-muted-foreground">Uploaded file</p>
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" onClick={clearMusicSelection}>
                    <Trash2 className="w-4 h-4 text-muted-foreground" />
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center p-6 border rounded-lg border-dashed bg-muted/20 space-y-4">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="audio/*,.mp3,.wav,.m4a"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleFileUpload(file);
                    }}
                  />
                  <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
                    {isUploading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
                    {isUploading ? "Uploading..." : "Select Audio File"}
                  </Button>
                </div>
              )}
            </TabsContent>

            <TabsContent value="suno">
              {musicObjectPath && musicTitle && musicSource === "suno" ? (
                <div className="border border-[#1DB954]/20 bg-[#1DB954]/5 p-4 rounded-lg flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <MonitorPlay className="w-5 h-5 text-[#1DB954] shrink-0" />
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{musicTitle}</p>
                      <p className="text-xs text-muted-foreground">Imported from Suno</p>
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" onClick={clearMusicSelection}>
                    <Trash2 className="w-4 h-4 text-muted-foreground" />
                  </Button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Input
                    placeholder="Paste a Suno song link..."
                    value={sunoInputUrl}
                    onChange={(e) => setSunoInputUrl(e.target.value)}
                    disabled={isImportingSuno}
                  />
                  <Button
                    onClick={handleSunoImport}
                    disabled={!sunoInputUrl || isImportingSuno}
                  >
                    {isImportingSuno ? <Loader2 className="w-4 h-4 animate-spin" /> : "Import"}
                  </Button>
                </div>
              )}
            </TabsContent>

            {/* Audio preview player for library, upload, and suno */}
            {musicPreviewUrl && ["soundtrack", "upload", "suno"].includes(musicSource) && (
              <div className="mt-3">
                <audio controls src={musicPreviewUrl} className="w-full h-8" />
              </div>
            )}
          </div>
        </Tabs>
      </div>

      <div className="pt-6 border-t flex items-center justify-between">
        <div className="flex flex-col">
          <span className="text-sm font-medium">Narration Audio Estimate</span>
          {script.length < 40 ? (
            <span className="text-sm text-muted-foreground">Enter a valid script</span>
          ) : !isSelectionComplete() ? (
            <span className="text-sm text-muted-foreground">Select an audio track</span>
          ) : estimateMutation.isError ? (
            <span className="text-sm text-destructive">Error</span>
          ) : (
            <span className="text-2xl font-bold font-mono tracking-tight text-primary">
              {estimateMutation.isPending ? "..." : (estimateMutation.data?.estimatedCost ?? "-")}
              <span className="text-sm font-normal text-muted-foreground ml-1">credits</span>
            </span>
          )}
          <span className="mt-1 max-w-sm text-xs text-muted-foreground">
            This is the complete audio-only charge. Video credits are estimated separately if you choose Use in Video.
          </span>
        </div>
        <Button 
          onClick={handleGenerate} 
          disabled={script.length < 40 || createMutation.isPending || !isSelectionComplete() || estimateMutation.isPending || estimateMutation.isError}
          className="min-w-[120px] shadow-glow"
        >
          {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Generate Narration"}
        </Button>
      </div>
    </div>
  );
}
