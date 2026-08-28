export type GalleryImageOrderFields = {
  jobId: string;
  assetIndex: number;
  createdAt: string;
};

/**
 * Keep packs together in the personal gallery while preserving each pack's
 * authored scene order. The API returns individual assets, so this also makes
 * the ordering deterministic after older pages are appended.
 */
export function orderGalleryImages<T extends GalleryImageOrderFields>(assets: T[]): T[] {
  const packs = new Map<string, T[]>();
  for (const asset of assets) {
    const pack = packs.get(asset.jobId) ?? [];
    pack.push(asset);
    packs.set(asset.jobId, pack);
  }

  return [...packs.values()]
    .sort((a, b) => {
      const newestA = Math.max(...a.map((asset) => new Date(asset.createdAt).getTime()));
      const newestB = Math.max(...b.map((asset) => new Date(asset.createdAt).getTime()));
      return newestB - newestA;
    })
    .flatMap((pack) => [...pack].sort((a, b) => a.assetIndex - b.assetIndex));
}