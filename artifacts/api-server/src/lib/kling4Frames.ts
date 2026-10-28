import sharp from "sharp";

/** Decode owned stored bytes, never a user-supplied remote URL. */
export async function validateKling4Frame(buffer: Buffer): Promise<void> {
  if (buffer.length > 30 * 1024 * 1024) throw new Error("Image exceeds 30 MB.");
  const image = sharp(buffer, { limitInputPixels: 40_000_000 });
  const meta = await image.metadata();
  const ratio = (meta.width ?? 0) / (meta.height ?? 1);
  if (!["png", "jpeg"].includes(meta.format ?? "") || (meta.width ?? 0) < 300 || (meta.height ?? 0) < 300 || ratio < 0.4 || ratio > 2.5) {
    throw new Error("Invalid frame format, dimensions, or aspect ratio.");
  }
  // Metadata alone can succeed for a truncated image.
  await image.resize(1, 1).raw().toBuffer();
}
