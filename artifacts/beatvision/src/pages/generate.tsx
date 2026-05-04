import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@workspace/replit-auth-web";
import { useCreateJob, CreateJobRequestAudioSourceType, VideoStyle } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ObjectUploader } from "@workspace/object-storage-web";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { motion } from "framer-motion";
import {
  Upload, Link as LinkIcon, Music, Sparkles, Loader2,
  Users, Clapperboard, Layers, Zap, Film, Wand2, Video as VideoIcon, FileText,
} from "lucide-react";

const STYLES = [
  { id: VideoStyle.realistic, label: "Realistic", icon: Users },
  { id: VideoStyle.anime, label: "Anime", icon: Sparkles },
  { id: VideoStyle.cinematic, label: "Cinematic", icon: Clapperboard },
  { id: VideoStyle.abstract, label: "Abstract", icon: Layers },
  { id: VideoStyle.neon, label: "Neon Glow", icon: Zap },
  { id: VideoStyle.vintage, label: "Vintage", icon: Film },
  { id: VideoStyle.fantasy, label: "Fantasy", icon: Wand2 },
  { id: VideoStyle.documentary, label: "Docu-style", icon: VideoIcon },
];

export default function Generate() {
  const [, setLocation] = useLocation();
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();

  const [sourceType, setSourceType] = useState<CreateJobRequestAudioSourceType>(
    CreateJobRequestAudioSourceType.upload,
  );
  const [audioUrl, setAudioUrl] = useState("");
  const [objectPath, setObjectPath] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [selectedStyle, setSelectedStyle] = useState<VideoStyle>(VideoStyle.cinematic);
  const [lyricsEnabled, setLyricsEnabled] = useState(false);
  const [lyricsText, setLyricsText] = useState("");

  const createJob = useCreateJob();

  useEffect(() => {
    if (!isAuthLoading && !isAuthenticated) setLocation("/login");
  }, [isAuthenticated, isAuthLoading, setLocation]);

  if (isAuthLoading || !isAuthenticated) return null;

  const handleGenerate = () => {
    if (!prompt) return alert("Please enter a prompt");
    if (sourceType === CreateJobRequestAudioSourceType.upload && !objectPath)
      return alert("Please upload an audio file");
    if (sourceType !== CreateJobRequestAudioSourceType.upload && !audioUrl)
      return alert("Please enter a URL");

    createJob.mutate(
      {
        data: {
          prompt,
          style: selectedStyle,
          audioSourceType: sourceType,
          audioObjectPath:
            sourceType === CreateJobRequestAudioSourceType.upload ? objectPath : null,
          audioSourceUrl:
            sourceType !== CreateJobRequestAudioSourceType.upload ? audioUrl : null,
          lyricsText: lyricsEnabled && lyricsText.trim() ? lyricsText.trim() : null,
        },
      },
      {
        onSuccess: (job) => setLocation(`/jobs/${job.id}`),
      },
    );
  };

  return (
    <div className="container mx-auto px-4 py-12 max-w-4xl">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-8"
      >
        <div>
          <h1 className="text-4xl font-bold tracking-tight mb-2">Create New Video</h1>
          <p className="text-muted-foreground">
            Upload a track, our AI analyses the beats, and generates a synced music video.
          </p>
        </div>

        <div className="grid gap-8 p-8 rounded-2xl bg-card border border-card-border shadow-lg">
          <Tabs
            value={sourceType}
            onValueChange={(v) => setSourceType(v as CreateJobRequestAudioSourceType)}
            className="w-full"
          >
            <TabsList className="grid w-full grid-cols-2 mb-6">
              <TabsTrigger
                value={CreateJobRequestAudioSourceType.upload}
                className="flex items-center gap-2"
              >
                <Upload className="h-4 w-4" /> Upload Audio
              </TabsTrigger>
              <TabsTrigger
                value={CreateJobRequestAudioSourceType.youtube}
                className="flex items-center gap-2"
              >
                <LinkIcon className="h-4 w-4" /> Paste Link
              </TabsTrigger>
            </TabsList>

            <TabsContent value={CreateJobRequestAudioSourceType.upload} className="mt-0">
              <div className="border-2 border-dashed border-border rounded-xl p-8 flex flex-col items-center justify-center text-center">
                {objectPath ? (
                  <div className="flex flex-col items-center gap-4">
                    <div className="h-16 w-16 rounded-full bg-primary/20 flex items-center justify-center">
                      <Music className="h-8 w-8 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium text-lg">Audio ready</p>
                      <p className="text-sm text-muted-foreground">File uploaded successfully</p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => setObjectPath(null)}>
                      Replace file
                    </Button>
                  </div>
                ) : (
                  <ObjectUploader
                    onGetUploadParameters={async (file) => {
                      const res = await fetch("/api/storage/uploads/request-url", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          name: file.name,
                          size: file.size,
                          contentType: file.type,
                        }),
                      });
                      const data = await res.json();
                      return {
                        method: "PUT",
                        url: data.uploadURL,
                        headers: { "Content-Type": file.type },
                      };
                    }}
                    onComplete={(result) => {
                      if (result.successful.length > 0) {
                        const url = new URL(result.successful[0].uploadURL);
                        const match = url.pathname.match(/(\/objects\/.*)/);
                        if (match) {
                          setObjectPath(match[1]);
                        } else {
                          const parts = url.pathname.split("/");
                          const idx = parts.indexOf("objects");
                          if (idx !== -1) setObjectPath("/" + parts.slice(idx).join("/"));
                        }
                      }
                    }}
                  >
                    Upload MP3 / WAV
                  </ObjectUploader>
                )}
              </div>
            </TabsContent>

            <TabsContent value={CreateJobRequestAudioSourceType.youtube} className="mt-0">
              <div className="space-y-4">
                <Label htmlFor="audio-url">YouTube or Suno URL</Label>
                <Input
                  id="audio-url"
                  placeholder="https://youtube.com/watch?v=..."
                  value={audioUrl}
                  onChange={(e) => setAudioUrl(e.target.value)}
                  className="h-12 bg-background/50 border-input"
                />
              </div>
            </TabsContent>
          </Tabs>

          <div className="space-y-4">
            <Label htmlFor="prompt">Creative Prompt</Label>
            <Textarea
              id="prompt"
              placeholder="Describe the visual style, subject matter, and mood you want..."
              className="min-h-[100px] resize-none bg-background/50 border-input"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
          </div>

          <div className="space-y-4">
            <Label>Visual Style</Label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {STYLES.map((style) => {
                const Icon = style.icon;
                return (
                  <div
                    key={style.id}
                    onClick={() => setSelectedStyle(style.id)}
                    className={`cursor-pointer rounded-xl border p-4 transition-all hover:border-primary/50 flex flex-col items-center justify-center text-center gap-2 ${
                      selectedStyle === style.id
                        ? "border-primary bg-primary/10 shadow-glow"
                        : "border-border bg-background/50 hover:bg-background/80"
                    }`}
                  >
                    <Icon className="h-6 w-6 text-primary/80" />
                    <span className="text-sm font-medium">{style.label}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-xl border border-border bg-background/30 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" />
                <Label htmlFor="lyrics-toggle" className="cursor-pointer font-medium">
                  Lyrics Overlay
                </Label>
                <span className="text-xs text-muted-foreground">
                  — burns subtitle text onto the video
                </span>
              </div>
              <Switch
                id="lyrics-toggle"
                checked={lyricsEnabled}
                onCheckedChange={setLyricsEnabled}
              />
            </div>

            {lyricsEnabled && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
              >
                <Textarea
                  placeholder="Paste your lyrics here. They'll be overlaid on the video as rolling subtitles..."
                  className="min-h-[120px] resize-none bg-background/50 border-input"
                  value={lyricsText}
                  onChange={(e) => setLyricsText(e.target.value)}
                  maxLength={5000}
                />
                <p className="text-xs text-muted-foreground mt-1.5">
                  {lyricsText.length}/5000 characters
                </p>
              </motion.div>
            )}
          </div>

          <Button
            size="lg"
            className="w-full h-14 text-lg bg-gradient-electric text-white shadow-glow mt-2"
            disabled={createJob.isPending}
            onClick={handleGenerate}
          >
            {createJob.isPending ? (
              <Loader2 className="h-6 w-6 animate-spin" />
            ) : (
              <>
                <Sparkles className="mr-2 h-5 w-5" />
                Generate Beat-Synced Video
              </>
            )}
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
