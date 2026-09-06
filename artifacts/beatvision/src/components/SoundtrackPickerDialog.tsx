import { useState, type ReactNode } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Music2, Check } from "lucide-react";

export interface PickedSoundtrack {
  id?: string;
  objectPath: string;
  url: string;
  title: string;
}

interface LibTrack {
  id: string;
  title: string | null;
  prompt: string | null;
  objectPath: string;
  durationSeconds: number | null;
  loopedToSeconds: number | null;
  url: string;
}

export function SoundtrackPickerDialog({
  children,
  onSelect,
}: {
  children: ReactNode;
  onSelect: (t: PickedSoundtrack) => void;
}) {
  const [open, setOpen] = useState(false);

  const { data: tracks, isLoading, error } = useQuery({
    queryKey: ["soundtracks", "picker"],
    queryFn: async (): Promise<LibTrack[]> => {
      const res = await fetch("/api/music/soundtracks", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load");
      return (await res.json()).soundtracks;
    },
    enabled: open,
  });

  const pick = (t: LibTrack) => {
    onSelect({ id: t.id, objectPath: t.objectPath, url: t.url, title: t.title || "AI-generated music" });
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Music2 className="h-5 w-5 text-primary" /> Choose Music
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : error ? (
          <div className="py-10 text-center text-sm text-muted-foreground">Couldn't load My Music. Try again in a moment.</div>
        ) : !tracks || tracks.length === 0 ? (
          <div className="py-10 text-center">
            <p className="text-sm text-muted-foreground">You don't have any music yet.</p>
            <Link href="/soundtracks">
              <Button size="sm" className="mt-3 border-0 bg-gradient-electric text-white" onClick={() => setOpen(false)}>Create one</Button>
            </Link>
          </div>
        ) : (
          <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
            {tracks.map((t) => (
              <div key={t.id} className="flex items-center gap-3 rounded-lg border border-border bg-card/40 p-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{t.title || "AI-generated music"}</p>
                  <audio controls preload="none" src={t.url} className="mt-1.5 h-8 w-full" />
                </div>
                <Button size="sm" className="h-8 shrink-0 border-0 bg-gradient-electric text-white" onClick={() => pick(t)}>
                  <Check className="mr-1 h-3.5 w-3.5" /> Use
                </Button>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
