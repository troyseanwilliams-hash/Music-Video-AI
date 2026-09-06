import { Storage, File } from "@google-cloud/storage";
import { withResourceLease } from "@workspace/db";
import { createReadStream, createWriteStream } from "fs";
import { Readable, Writable } from "stream";
import { pipeline } from "stream/promises";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

export const objectStorageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: {
        type: "json",
        subject_token_field_name: "access_token",
      },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

type GcsWriteOptions = Parameters<File["createWriteStream"]>[0];

async function writeBufferAbortable(file: File, buffer: Buffer, options: GcsWriteOptions): Promise<void> {
  await withResourceLease("object_storage_transfer", async ({ signal }) => {
    await pipeline(Readable.from(buffer), file.createWriteStream(options), { signal });
  });
}

async function readBufferAbortable(file: File): Promise<Buffer> {
  return withResourceLease("object_storage_transfer", async ({ signal }) => {
    const chunks: Buffer[] = [];
    const sink = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        callback();
      },
    });
    await pipeline(file.createReadStream(), sink, { signal });
    return Buffer.concat(chunks);
  });
}

async function downloadFileAbortable(file: File, destination: string): Promise<void> {
  await withResourceLease("object_storage_transfer", async ({ signal }) => {
    await pipeline(file.createReadStream(), createWriteStream(destination), { signal });
  });
}

async function uploadFileAbortable(file: File, sourcePath: string, options: GcsWriteOptions): Promise<void> {
  await withResourceLease("object_storage_transfer", async ({ signal }) => {
    await pipeline(createReadStream(sourcePath), file.createWriteStream(options), { signal });
  });
}

export class ObjectStorageService {
  getPrivateObjectDir(): string {
    const dir = process.env.PRIVATE_OBJECT_DIR ?? "";
    if (!dir) throw new Error("PRIVATE_OBJECT_DIR not set");
    return dir;
  }

  async getObjectEntityFile(objectPath: string): Promise<File> {
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }
    const parts = objectPath.slice(1).split("/");
    if (parts.length < 2) {
      throw new ObjectNotFoundError();
    }
    const entityId = parts.slice(1).join("/");
    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith("/")) {
      entityDir = `${entityDir}/`;
    }
    const objectEntityPath = `${entityDir}${entityId}`;
    const { bucketName, objectName } = parseObjectPath(objectEntityPath);
    const bucket = objectStorageClient.bucket(bucketName);
    const objectFile = bucket.file(objectName);
    const [exists] = await objectFile.exists();
    if (!exists) {
      throw new ObjectNotFoundError();
    }
    return objectFile;
  }

  // Permanently delete an object by its /objects/... path. Best-effort:
  // silently ignores blank paths and objects that no longer exist.
  async deleteObject(objectPath: string | null | undefined): Promise<void> {
    if (!objectPath || !objectPath.startsWith("/objects/")) return;
    const parts = objectPath.slice(1).split("/");
    if (parts.length < 2) return;
    const entityId = parts.slice(1).join("/");
    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith("/")) entityDir = `${entityDir}/`;
    const objectEntityPath = `${entityDir}${entityId}`;
    const { bucketName, objectName } = parseObjectPath(objectEntityPath);
    const bucket = objectStorageClient.bucket(bucketName);
    await bucket.file(objectName).delete({ ignoreNotFound: true });
  }

  // Delete every stored asset for a video: the MP4, its thumbnail, and any
  // per-clip files. Each delete is independent and best-effort.
  async deleteVideoAssets(video: {
    videoObjectPath?: string | null;
    previewObjectPath?: string | null;
    thumbnailObjectPath?: string | null;
    clips?: unknown;
  }): Promise<void> {
    const paths: string[] = [];
    if (video.videoObjectPath) paths.push(video.videoObjectPath);
    if (video.previewObjectPath) paths.push(video.previewObjectPath);
    if (video.thumbnailObjectPath) paths.push(video.thumbnailObjectPath);
    if (Array.isArray(video.clips)) {
      for (const c of video.clips) {
        const p = c && typeof c === "object" ? (c as { objectPath?: unknown }).objectPath : null;
        if (typeof p === "string") paths.push(p);
      }
    }
    await Promise.all(paths.map((p) => this.deleteObject(p).catch(() => {})));
  }

  async getObjectEntitySignedUrl(objectPath: string, ttlSec: number = 3600): Promise<string> {
    if (!objectPath.startsWith("/objects/")) throw new ObjectNotFoundError();
    const parts = objectPath.slice(1).split("/");
    if (parts.length < 2) throw new ObjectNotFoundError();
    const entityId = parts.slice(1).join("/");
    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith("/")) entityDir = `${entityDir}/`;
    const objectEntityPath = `${entityDir}${entityId}`;
    const { bucketName, objectName } = parseObjectPath(objectEntityPath);
    return signObjectURL({ bucketName, objectName, method: "GET", ttlSec });
  }

  async uploadVideoBuffer(buffer: Buffer, videoId: string): Promise<string> {
    const privateObjectDir = this.getPrivateObjectDir();
    const objectEntityPath = `${privateObjectDir}/videos/${videoId}.mp4`;
    const { bucketName, objectName } = parseObjectPath(objectEntityPath);
    const bucket = objectStorageClient.bucket(bucketName);
    const file = bucket.file(objectName);
    await writeBufferAbortable(file, buffer, {
      resumable: buffer.length > 5 * 1024 * 1024,
      metadata: { contentType: "video/mp4" },
    });
    return `/objects/videos/${videoId}.mp4`;
  }

  async uploadVideoPreviewBuffer(buffer: Buffer, videoId: string): Promise<string> {
    const privateObjectDir = this.getPrivateObjectDir();
    const objectEntityPath = `${privateObjectDir}/video-previews/${videoId}.mp4`;
    const { bucketName, objectName } = parseObjectPath(objectEntityPath);
    const bucket = objectStorageClient.bucket(bucketName);
    const file = bucket.file(objectName);
    await writeBufferAbortable(file, buffer, {
      resumable: buffer.length > 5 * 1024 * 1024,
      metadata: { contentType: "video/mp4" },
    });
    return `/objects/video-previews/${videoId}.mp4`;
  }

  async downloadObjectBuffer(objectPath: string): Promise<Buffer> {
    const file = await this.getObjectEntityFile(objectPath);
    return readBufferAbortable(file);
  }

  async objectExists(objectPath: string): Promise<boolean> {
    try {
      await this.getObjectEntityFile(objectPath);
      return true;
    } catch (err) {
      if (err instanceof ObjectNotFoundError) return false;
      throw err;
    }
  }

  async uploadVideoFromUrl(videoUrl: string, videoId: string): Promise<string> {
    const res = await fetch(videoUrl, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`Failed to download video: HTTP ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    return this.uploadVideoBuffer(buffer, videoId);
  }

  // Persist a trimmed song segment (e.g. for the admin Runway Lip Sync
  // Generator) so it can be signed into a URL and handed to a video provider.
  async uploadAudioBuffer(buffer: Buffer, songId: string, ext = "mp3", userId?: string): Promise<string> {
    const privateObjectDir = this.getPrivateObjectDir();
    const ownerPrefix = userId ? `${userId}/` : "";
    const objectEntityPath = `${privateObjectDir}/audio/${ownerPrefix}${songId}.${ext}`;
    const { bucketName, objectName } = parseObjectPath(objectEntityPath);
    const bucket = objectStorageClient.bucket(bucketName);
    const file = bucket.file(objectName);
    const contentType = ext === "wav" ? "audio/wav" : "audio/mpeg";
    await writeBufferAbortable(file, buffer, { metadata: { contentType }, resumable: buffer.length > 5 * 1024 * 1024 });
    return `/objects/audio/${ownerPrefix}${songId}.${ext}`;
  }

  async uploadThumbnailBuffer(buffer: Buffer, videoId: string): Promise<string> {
    const privateObjectDir = this.getPrivateObjectDir();
    const objectEntityPath = `${privateObjectDir}/thumbnails/${videoId}.jpg`;
    const { bucketName, objectName } = parseObjectPath(objectEntityPath);
    const bucket = objectStorageClient.bucket(bucketName);
    const file = bucket.file(objectName);
    await writeBufferAbortable(file, buffer, { metadata: { contentType: "image/jpeg" }, resumable: false });
    return `/objects/thumbnails/${videoId}.jpg`;
  }

  // Persist a generated narrative still. Image sequences are job inputs on later
  // recovery attempts, so keep them in private storage rather than depending on
  // a provider-hosted URL that may expire.
  async uploadNarrativeImageBuffer(buffer: Buffer, jobId: string, index: number): Promise<string> {
    const privateObjectDir = this.getPrivateObjectDir();
    const objectEntityPath = `${privateObjectDir}/narrative-images/${jobId}/${index}.jpg`;
    const { bucketName, objectName } = parseObjectPath(objectEntityPath);
    const file = objectStorageClient.bucket(bucketName).file(objectName);
    await writeBufferAbortable(file, buffer, { metadata: { contentType: "image/jpeg" }, resumable: buffer.length > 5 * 1024 * 1024 });
    return `/objects/narrative-images/${jobId}/${index}.jpg`;
  }

  // Persist a reusable still from an images-only job. These objects are later
  // added directly to a Remix Lab timeline as photo segments.
  async uploadImagePackBuffer(buffer: Buffer, jobId: string, index: number): Promise<string> {
    const privateObjectDir = this.getPrivateObjectDir();
    const objectEntityPath = `${privateObjectDir}/image-packs/${jobId}/${index}.jpg`;
    const { bucketName, objectName } = parseObjectPath(objectEntityPath);
    const file = objectStorageClient.bucket(bucketName).file(objectName);
    await writeBufferAbortable(file, buffer, {
      resumable: false,
      metadata: { contentType: "image/jpeg", cacheControl: "private, max-age=3600" },
    });
    return `/objects/image-packs/${jobId}/${index}.jpg`;
  }

  // Persist a single generated clip so it can be reused by a later remix without
  // regenerating it. Returns the /objects/... path stored on videos.clips.
  async uploadClipBuffer(buffer: Buffer, videoId: string, index: number): Promise<string> {
    const privateObjectDir = this.getPrivateObjectDir();
    const objectEntityPath = `${privateObjectDir}/clips/${videoId}/${index}.mp4`;
    const { bucketName, objectName } = parseObjectPath(objectEntityPath);
    const bucket = objectStorageClient.bucket(bucketName);
    const file = bucket.file(objectName);
    await writeBufferAbortable(file, buffer, { metadata: { contentType: "video/mp4" }, resumable: buffer.length > 5 * 1024 * 1024 });
    return `/objects/clips/${videoId}/${index}.mp4`;
  }

  async uploadPodcastBuffer(buffer: Buffer, podcastId: string, name: string, contentType: string): Promise<string> {
    const privateObjectDir = this.getPrivateObjectDir();
    const objectEntityPath = `${privateObjectDir}/podcasts/${podcastId}/${name}`;
    const { bucketName, objectName } = parseObjectPath(objectEntityPath);
    await writeBufferAbortable(objectStorageClient.bucket(bucketName).file(objectName), buffer, {
      resumable: buffer.length > 5 * 1024 * 1024,
      metadata: { contentType },
    });
    return `/objects/podcasts/${podcastId}/${name}`;
  }

  async downloadObjectToFile(objectPath: string, destination: string): Promise<void> {
    const file = await this.getObjectEntityFile(objectPath);
    await downloadFileAbortable(file, destination);
  }

  async uploadPodcastFile(sourcePath: string, podcastId: string, name: string, contentType: string): Promise<string> {
    const privateObjectDir = this.getPrivateObjectDir();
    const objectEntityPath = `${privateObjectDir}/podcasts/${podcastId}/${name}`;
    const { bucketName, objectName } = parseObjectPath(objectEntityPath);
    await uploadFileAbortable(objectStorageClient.bucket(bucketName).file(objectName), sourcePath, {
      resumable: true,
      metadata: { contentType },
    });
    return `/objects/podcasts/${podcastId}/${name}`;
  }
}

function parseObjectPath(path: string): { bucketName: string; objectName: string } {
  if (!path.startsWith("/")) path = `/${path}`;
  const parts = path.split("/");
  if (parts.length < 3) throw new Error("Invalid storage path");
  return { bucketName: parts[1]!, objectName: parts.slice(2).join("/") };
}

async function signObjectURL({
  bucketName,
  objectName,
  method,
  ttlSec,
}: {
  bucketName: string;
  objectName: string;
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  ttlSec: number;
}): Promise<string> {
  const request = {
    bucket_name: bucketName,
    object_name: objectName,
    method,
    expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
  };
  const response = await fetch(
    `${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Failed to sign object URL: ${response.status}`,
    );
  }
  return ((await response.json()) as { signed_url: string }).signed_url;
}
