import { Download } from "lucide-react";
import { Link } from "wouter";

export const STORAGE_RETENTION_MESSAGE =
  "Please download and keep a copy of your videos, images, and audio. Your files are stored for 30 days after your paid membership or free trial ends, then permanently deleted. Download anything you want to keep before then.";

export function StorageRetentionNotice() {
  return (
    <aside aria-label="File storage policy" className="mb-6 flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
      <Download className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
      <div>
        <p className="font-semibold text-foreground">Download and back up your files</p>
        <p className="mt-1 text-muted-foreground">{STORAGE_RETENTION_MESSAGE}</p>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          <Link href="/gallery" className="text-primary underline underline-offset-4">Download videos and images</Link>
          <Link href="/soundtracks" className="text-primary underline underline-offset-4">Download audio</Link>
          <Link href="/terms#file-storage" className="text-primary underline underline-offset-4">File storage policy</Link>
        </div>
      </div>
    </aside>
  );
}
