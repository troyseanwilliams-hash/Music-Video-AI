import { useLocation, Link } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, Music2, Download, Video, Trash2, Share2, Link2, Lock, Wand2,
} from "lucide-react";

interface Soundtrack {
  id: string;
  title: string | null;
  prompt: string | null;
  objectPath: string;
  ext: string;
  durationSeconds: number | null;
  loopedToSeconds: number | null;
  provider: string | null;
  isPublic: boolean;
  shareToken: string | null;
  createdAt: string;
  url: string;
}

async function fetchSoundtracks(): Promise<Soundtrack[]> {
  const res = await fetch("/api/music/soundtracks", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to load soundtracks");
  const data = await res.json();
  return data.soundtracks;
}

function fmtLen(s: Soundtrack): string {
  if (s.loopedToSeconds) return `${s.loopedToSeconds}s (looped)`;
  if (s.durationSeconds) return `${s.durationSeconds}s`;
  return "";
}

export default function Soundtracks() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  const { data: tracks, isLoading, error } = useQuery({
    queryKey: ["soundtracks"],
    queryFn: fetchSoundtracks,
    enabled: isAuthenticated,
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/music/soundtracks/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Delete failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["soundtracks"] });
      toast({ title: "Deleted" });
    },
    onError: () => toast({ title: "Couldn't delete", variant: "destructive" }),
  });

  const togglePublic = useMutation({
    mutationFn: async ({ id, isPublic }: { id: string; isPublic: boolean }) => {
      const res = await fetch(`/api/music/soundtracks/${id}/public`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPublic }),
      });
      if (!res.ok) throw new Error("Update failed");
      return res.json() as Promise<{ isPublic: boolean; shareToken: string; sharePath: string }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["soundtracks"] });
      if (data.isPublic) {
        const link = `${window.location.origin}${data.sharePath}`;
        navigator.clipboard?.writeText(link).catch(() => {});
        toast({ title: "Public — link copied", description: link });
      } else {
        toast({ title: "Set to private" });
      }
    },
    onError: () => toast({ title: "Couldn't update sharing", variant: "destructive" }),
  });

  const reuse = (s: Soundtrack) => {
    const title = encodeURIComponent(s.title || "AI Soundtrack");
    navigate(`/generate?audioObjectPath=${encodeURIComponent(s.objectPath)}&title=${title}`);
  };

  const copyLink = (s: Soundtrack) => {
    if (!s.shareToken) return;
    const link = `${window.location.origin}/s/${s.shareToken}`;
    navigator.clipboard?.writeText(link).catch(() => {});
    toast({ title: "Link copied", description: link });
  };

  if (authLoading) {
    return <div className="flex items-center justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }
  if (!isAuthenticated) {
    return (
      <div className="container mx-auto px-4 py-16 text-center">
        <Music2 className="h-10 w-10 mx-auto text-muted-foreground mb-4" />
        <h1 className="text-xl font-semibold mb-2">Your Soundtracks</h1>
        <p className="text-muted-foreground mb-6">Sign in to see the soundtracks you've generated.</p>
        <Link href="/login"><Button className="bg-gradient-electric text-white border-0">Sign in</Button></Link>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl">
      <div className="flex items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Music2 className="h-6 w-6 text-primary" /> Your Soundtracks
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Royalty-free instrumentals you've generated. Play, download, reuse in a video, or share.
          </p>
        </div>
        <Link href="/generate">
          <Button className="bg-gradient-electric text-white border-0 shrink-0">
            <Wand2 className="h-4 w-4 mr-2" /> New Soundtrack
          </Button>
        </Link>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : error ? (
        <div className="py-16 text-center text-sm text-destructive">Failed to load your soundtracks.</div>
      ) : !tracks || tracks.length === 0 ? (
        <div className="py-20 text-center">
          <Music2 className="h-10 w-10 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground mb-6">No soundtracks yet. Generate your first one.</p>
          <Link href="/generate"><Button className="bg-gradient-electric text-white border-0"><Wand2 className="h-4 w-4 mr-2" /> Generate a Soundtrack</Button></Link>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {tracks.map((s) => (
            <Card key={s.id} className="bg-card/50 border-card-border overflow-hidden">
              <div className="h-1 w-full bg-gradient-electric" />
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="font-semibold truncate">{s.title || "AI Soundtrack"}</h3>
                    {s.prompt && <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{s.prompt}</p>}
                  </div>
                  {s.isPublic && <Badge variant="outline" className="text-[10px] shrink-0">Public</Badge>}
                </div>

                <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                  {fmtLen(s) && <span className="rounded-full border border-border px-2 py-0.5">{fmtLen(s)}</span>}
                  {s.provider && <span className="rounded-full border border-border px-2 py-0.5">{s.provider}</span>}
                  <span className="rounded-full border border-border px-2 py-0.5">{new Date(s.createdAt).toLocaleDateString()}</span>
                </div>

                <audio controls preload="none" src={s.url} className="w-full h-9" />

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Button size="sm" onClick={() => reuse(s)} className="bg-gradient-electric text-white border-0 h-8">
                    <Video className="h-3.5 w-3.5 mr-1.5" /> Use in video
                  </Button>
                  <a href={s.url} download={`${(s.title || "soundtrack").replace(/[^\w-]+/g, "_")}.${s.ext}`}>
                    <Button size="sm" variant="outline" className="h-8"><Download className="h-3.5 w-3.5 mr-1.5" /> Download</Button>
                  </a>
                  {s.isPublic ? (
                    <>
                      <Button size="sm" variant="outline" className="h-8" onClick={() => copyLink(s)}>
                        <Link2 className="h-3.5 w-3.5 mr-1.5" /> Copy link
                      </Button>
                      <Button size="sm" variant="ghost" className="h-8" onClick={() => togglePublic.mutate({ id: s.id, isPublic: false })}>
                        <Lock className="h-3.5 w-3.5 mr-1.5" /> Make private
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" variant="outline" className="h-8" onClick={() => togglePublic.mutate({ id: s.id, isPublic: true })}>
                      <Share2 className="h-3.5 w-3.5 mr-1.5" /> Share
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" className="h-8 text-destructive hover:text-destructive ml-auto" onClick={() => del.mutate(s.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
