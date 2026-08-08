import { useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Smile, Upload } from "lucide-react";

// Lip sync is billed per second (OmniHuman ~$0.16/s at 1.5× = 16 credits/s).
const LIP_OPTIONS = [5, 10, 15, 20, 30];
const CREDITS_PER_SEC = 16;

async function presignAndUpload(file: File): Promise<string> {
  const res = await fetch("/api/storage/uploads/request-url", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
  });
  if (!res.ok) throw new Error("Could not get an upload URL");
  const { uploadURL, objectPath } = await res.json();
  const put = await fetch(uploadURL, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
  if (!put.ok) throw new Error(`Upload failed (${put.status})`);
  return objectPath as string;
}

/**
 * Lip Sync: upload a face photo and turn it into a singing avatar synced to a
 * short clip of this video's song, via the Pixazo OmniHuman lipsync API.
 */
export default function LipSyncPanel({ videoId }: { videoId: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [seconds, setSeconds] = useState(15);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ videoId: string; url: string } | null>(null);
  const [facePreview, setFacePreview] = useState<string | null>(null);
  const cost = seconds * CREDITS_PER_SEC;

  async function run(file: File) {
    setBusy(true);
    setError(null);
    setResult(null);
    setFacePreview(URL.createObjectURL(file));
    try {
      const imageObjectPath = await presignAndUpload(file);
      const r = await fetch(`/api/videos/${videoId}/lipsync`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageObjectPath, lipsyncSeconds: seconds }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Lip sync failed");
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lip sync failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <Smile className="h-4 w-4 text-primary" /> Lip Sync
          <span className="rounded-full border border-primary/25 bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">New</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Upload a face photo and we'll animate it to sing a short clip of this video's song. Takes a few minutes and
          saves as a new video in your library.
        </p>

        <div>
          <label className="text-sm font-medium">Clip length</label>
          <div className="grid grid-cols-5 gap-2 mt-1.5">
            {LIP_OPTIONS.map((s) => (
              <button
                key={s}
                type="button"
                disabled={busy}
                onClick={() => setSeconds(s)}
                className={`rounded-lg border px-2 py-2 text-xs font-medium transition-colors disabled:opacity-50 ${seconds === s ? "border-primary bg-primary/10 text-primary" : "border-border bg-background/40 text-muted-foreground hover:border-primary/50"}`}
              >
                {s}s
              </button>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1.5">
            <strong>{cost} credits</strong> — billed per second, synced to the first {seconds}s of the song.
          </p>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) run(f);
            e.target.value = "";
          }}
        />
        <div className="flex items-center gap-3">
          <Button variant="outline" disabled={busy} onClick={() => inputRef.current?.click()}>
            {busy ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Syncing… (a few min)</>
            ) : (
              <><Upload className="mr-2 h-4 w-4" /> Upload a face · {cost} cr</>
            )}
          </Button>
          {facePreview && !result && (
            <img src={facePreview} alt="Uploaded face photo preview" className="h-16 w-16 rounded-lg border border-border object-cover" />
          )}
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {result && (
          <div className="space-y-2">
            <video src={result.url} controls playsInline className="w-full max-w-md rounded-lg border border-border bg-black" />
            <p className="text-xs text-muted-foreground">Saved to your library as a new video.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
