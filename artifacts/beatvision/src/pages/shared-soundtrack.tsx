import { useRoute, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Music2, Download, Wand2 } from "lucide-react";

interface SharedTrack {
  title: string | null;
  prompt: string | null;
  provider: string | null;
  createdAt: string;
  url: string;
}

export default function SharedSoundtrack() {
  const [, params] = useRoute("/s/:token");
  const token = params?.token;

  const { data, isLoading, error } = useQuery({
    queryKey: ["shared-soundtrack", token],
    queryFn: async (): Promise<SharedTrack> => {
      const res = await fetch(`/api/music/shared/${token}`);
      if (!res.ok) throw new Error("Not found");
      return res.json();
    },
    enabled: !!token,
  });

  return (
    <div className="container mx-auto px-4 py-16 max-w-lg">
      {isLoading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : error || !data ? (
        <div className="text-center py-16">
          <Music2 className="h-10 w-10 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground">This soundtrack isn't available.</p>
        </div>
      ) : (
        <Card className="bg-card/50 border-card-border overflow-hidden">
          <div className="h-1 w-full bg-gradient-electric" />
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-2">
              <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
                <Music2 className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0">
                <h1 className="font-semibold truncate">{data.title || "AI Soundtrack"}</h1>
                <p className="text-xs text-muted-foreground">Shared from AIBeatSync</p>
              </div>
            </div>
            {data.prompt && <p className="text-sm text-muted-foreground">{data.prompt}</p>}
            <audio controls preload="none" src={data.url} className="w-full" />
            <div className="flex items-center gap-2 pt-1">
              <a href={data.url} download>
                <Button variant="outline" size="sm"><Download className="h-4 w-4 mr-2" /> Download</Button>
              </a>
              <Link href="/generate" className="ml-auto">
                <Button size="sm" className="bg-gradient-electric text-white border-0"><Wand2 className="h-4 w-4 mr-2" /> Make your own</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
