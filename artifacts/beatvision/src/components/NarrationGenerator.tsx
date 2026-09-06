import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Play, Square, AlertCircle, Download, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  useNarrationVoices,
  useEstimateNarration,
  useCreateNarration,
  useNarrationJob,
  isNarrationGenerating,
  type NarrationResultHandoff,
  type NarrationJob
} from "@/hooks/use-narration";

interface NarrationGeneratorProps {
  onHandoff: (handoff: NarrationResultHandoff, title: string) => void;
  onCostError?: (error: any) => void;
}

export function NarrationGenerator({ onHandoff, onCostError }: NarrationGeneratorProps) {
  const { toast } = useToast();
  const { isAuthenticated } = useAuth();
  
  const [script, setScript] = useState("");
  const [voiceId, setVoiceId] = useState<string>("");
  const [includeMusic, setIncludeMusic] = useState(false);
  const [musicPrompt, setMusicPrompt] = useState("");
  
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

  useEffect(() => {
    if (job?.status === "ready" || job?.status === "failed") {
      // Done polling
    }
  }, [job?.status]);

  const estimateMutation = useEstimateNarration();
  const createMutation = useCreateNarration();

  const [debouncedScript, setDebouncedScript] = useState(script);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedScript(script), 500);
    return () => clearTimeout(timer);
  }, [script]);

  useEffect(() => {
    if (debouncedScript.length >= 40) {
      estimateMutation.mutate({
        script: debouncedScript,
        voiceId,
        includeMusic,
        musicPrompt: includeMusic ? musicPrompt : undefined
      });
    }
  }, [debouncedScript, voiceId, includeMusic, musicPrompt]);

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
      audio.play().catch(err => {
        toast({ title: "Preview failed", description: "Could not play voice preview.", variant: "destructive" });
        setPlayingPreview(null);
      });
      audioRef.current = audio;
      setPlayingPreview(id);
    }
  };
  
  // Cleanup audio on unmount
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
    const idempotencyKey = crypto.randomUUID();
    createMutation.mutate(
      {
        script,
        voiceId,
        includeMusic,
        musicPrompt: includeMusic ? musicPrompt : undefined,
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
    if (job?.result?.handoff) {
      onHandoff(job.result.handoff, "AI Narration");
    }
  };

  const isGenerating = isNarrationGenerating(job?.status);
  
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
        
        <div className="flex flex-col gap-4">
          <audio controls src={job.result?.downloadPath} className="w-full" />
          
          <div className="flex items-center gap-3 mt-4">
            <Button onClick={handleHandoff} className="flex-1 font-medium shadow-glow">
              Use in Video
            </Button>
            <Button variant="outline" asChild>
              <a href={job.result?.downloadPath} download>
                <Download className="w-4 h-4 mr-2" />
                Download
              </a>
            </Button>
            <Button variant="ghost" onClick={() => {
              setActiveJobId(null);
              localStorage.removeItem("bv-active-narration-id");
            }}>
              New
            </Button>
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-3">
          <Label>Voice</Label>
          <div className="flex gap-2">
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
      </div>

      <div className="space-y-4 pt-2 border-t">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label>Background Music</Label>
            <p className="text-sm text-muted-foreground">AI generated music bed</p>
          </div>
          <Switch checked={includeMusic} onCheckedChange={setIncludeMusic} />
        </div>
        
        {includeMusic && (
          <div className="space-y-3 animate-in fade-in slide-in-from-top-2">
            <Label>Music Prompt (Optional)</Label>
            <Input 
              value={musicPrompt} 
              onChange={e => setMusicPrompt(e.target.value)} 
              placeholder="e.g. gentle acoustic guitar, ambient lofi..."
              maxLength={300}
            />
          </div>
        )}
      </div>

      <div className="pt-6 border-t flex items-center justify-between">
        <div className="flex flex-col">
          <span className="text-sm font-medium">Estimated Cost</span>
          {script.length >= 40 ? (
            <span className="text-2xl font-bold font-mono tracking-tight text-primary">
              {estimateMutation.isPending ? "..." : (estimateMutation.data?.estimatedCost ?? "-")}
              <span className="text-sm font-normal text-muted-foreground ml-1">credits</span>
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">Enter a valid script</span>
          )}
        </div>
        <Button 
          onClick={handleGenerate} 
          disabled={script.length < 40 || createMutation.isPending}
          className="min-w-[120px] shadow-glow"
        >
          {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Generate Narration"}
        </Button>
      </div>
    </div>
  );
}
