export const IMAGE_REMIX_KIND = "generated_images" as const;

export interface ImageRemixAsset {
  id?: string;
  objectPath: string;
  prompt: string;
  assetIndex: number;
}

export interface ImageRemixHandoff {
  kind: typeof IMAGE_REMIX_KIND;
  images: ImageRemixAsset[];
}

export function isValidImageRemixHandoff(value: unknown): value is ImageRemixHandoff {
  if (!value || typeof value !== "object") return false;
  const handoff = value as { kind?: unknown; images?: unknown };
  if (handoff.kind !== IMAGE_REMIX_KIND || !Array.isArray(handoff.images) || handoff.images.length === 0) {
    return false;
  }

  return handoff.images.every((image) => {
    if (!image || typeof image !== "object") return false;
    const asset = image as Partial<ImageRemixAsset>;
    const assetIndex = asset.assetIndex;
    return typeof asset.objectPath === "string"
      && asset.objectPath.startsWith("/objects/")
      && (asset.id === undefined || typeof asset.id === "string")
      && typeof asset.prompt === "string"
      && typeof assetIndex === "number"
      && Number.isInteger(assetIndex)
      && assetIndex >= 0;
  });
}