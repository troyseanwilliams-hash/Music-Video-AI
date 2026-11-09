import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, ChevronLeft, ChevronRight, Image as ImageIcon, Loader2, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface AdminImageAsset {
  id: string;
  userId: string;
  email: string | null;
  jobId: string;
  assetIndex: number;
  objectPath: string;
  prompt: string;
  isPublic: boolean;
  style: string | null;
  createdAt: string;
}

interface AdminImageAssetList {
  assets: AdminImageAsset[];
  total: number;
  page: number;
  limit: number;
}

const PAGE_SIZE = 24;

export default function AdminImagesPanel() {
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<AdminImageAsset | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPage(1);
      setSearch(searchInput.trim());
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<AdminImageAssetList>({
    queryKey: ["admin", "images", page, search],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
      if (search) params.set("search", search);
      const response = await fetch(`/api/admin/images?${params}`, { credentials: "include" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Could not load generated images");
      return body as AdminImageAssetList;
    },
    staleTime: 30_000,
  });

  const pageCount = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));

  return (
    <section className="space-y-4" aria-labelledby="admin-images-heading">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="admin-images-heading" className="text-xl font-semibold">Generated image review</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Review private and public generated images for community-guideline compliance. Only administrators can access this view.
          </p>
        </div>
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1 sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search prompt or account email"
              aria-label="Search prompts or creator email"
              className="pl-9"
            />
          </div>
          <Button variant="outline" onClick={() => void refetch()} disabled={isFetching} aria-label="Refresh images">
            {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Refresh"}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16" role="status" aria-label="Loading images">
          <Loader2 className="h-7 w-7 animate-spin text-primary" />
        </div>
      ) : isError ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="text-sm text-destructive">{error instanceof Error ? error.message : "Could not load generated images."}</p>
            <Button variant="outline" onClick={() => void refetch()}>Try again</Button>
          </CardContent>
        </Card>
      ) : data?.assets.length ? (
        <>
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {data.total.toLocaleString()} image{data.total === 1 ? "" : "s"} · page {page} of {pageCount}
          </p>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {data.assets.map((asset) => (
              <Card key={asset.id} className="overflow-hidden border-border/70">
                <button
                  type="button"
                  className="group relative block aspect-[4/3] w-full bg-black/90"
                  onClick={() => setSelected(asset)}
                  aria-label={`Inspect image from ${asset.email ?? "unknown account"}`}
                >
                  <img
                    src={`/api/storage${asset.objectPath}`}
                    alt={`Generated image. Prompt: ${asset.prompt}`}
                    loading="lazy"
                    className="h-full w-full object-contain transition-opacity group-hover:opacity-90"
                  />
                  <span className="absolute bottom-2 right-2 rounded-md bg-black/70 px-2 py-1 text-xs text-white">View image</span>
                </button>
                <CardContent className="space-y-2.5 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={asset.isPublic ? "default" : "secondary"}>{asset.isPublic ? "Public" : "Private"}</Badge>
                    {asset.style && <Badge variant="outline">{asset.style}</Badge>}
                  </div>
                  <p className="line-clamp-3 text-sm leading-relaxed">{asset.prompt}</p>
                  <div className="space-y-1 text-xs text-muted-foreground">
                    <p className="truncate" title={asset.email ?? asset.userId}>Account: {asset.email ?? asset.userId}</p>
                    <p className="flex items-center gap-1.5">
                      <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      {new Date(asset.createdAt).toLocaleString()}
                    </p>
                    <p className="truncate" title={asset.jobId}>Job: {asset.jobId}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="flex items-center justify-between border-t border-border/50 pt-3">
            <span className="text-xs text-muted-foreground">Newest images first</span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1 || isFetching}>
                <ChevronLeft className="mr-1 h-4 w-4" /> Previous
              </Button>
              <Button variant="outline" size="sm" onClick={() => setPage((current) => Math.min(pageCount, current + 1))} disabled={page >= pageCount || isFetching}>
                Next <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
          </div>
        </>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-14 text-center">
            <ImageIcon className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
            <p className="font-medium">{search ? "No matching images" : "No generated images to review"}</p>
            <p className="text-sm text-muted-foreground">{search ? "Try another prompt or email search." : "Generated images will appear here as users create them."}</p>
          </CardContent>
        </Card>
      )}

      <Dialog open={selected !== null} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle>Generated image review</DialogTitle>
                <DialogDescription>
                  {selected.email ?? selected.userId} · {new Date(selected.createdAt).toLocaleString()} · {selected.isPublic ? "Public" : "Private"}
                </DialogDescription>
              </DialogHeader>
              <div className="flex max-h-[65vh] justify-center rounded-lg bg-black/90 p-2">
                <img
                  src={`/api/storage${selected.objectPath}`}
                  alt={`Generated image. Prompt: ${selected.prompt}`}
                  className="max-h-[62vh] max-w-full object-contain"
                />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-semibold">Generation prompt</h3>
                <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{selected.prompt}</p>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
