import { Download } from "lucide-react";
import { Link } from "wouter";

export const STORAGE_RETENTION_MESSAGE =
  "Please download and keep a copy of your videos, images, and audio. Your files will only be stored for 30 days after your membership expires. Download everything you want to keep before that period ends.";

export function StorageRetentionNotice() {
  return (
    <aside aria-label="File storage policy" className="mb-6 flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
      <Download className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
      <div>
        <p className="font-semibold text-foreground">Download and back up your files</p>
        <p className="mt-1 text-muted-foreground">{STORAGE_RETENTION_MESSAGE}</p>
        <Link href="/terms#file-storage" className="mt-2 inline-block text-primary underline underline-offset-4">
          File storage policy
        </Link>
      </div>
    </aside>
  );
}
