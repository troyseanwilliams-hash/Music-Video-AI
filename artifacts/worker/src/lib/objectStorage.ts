import { Storage, File } from "@google-cloud/storage";

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
    await file.save(buffer, {
      contentType: "video/mp4",
      resumable: buffer.length > 5 * 1024 * 1024,
    });
    return `/objects/videos/${videoId}.mp4`;
  }

  async uploadVideoFromUrl(videoUrl: string, videoId: string): Promise<string> {
    const res = await fetch(videoUrl, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`Failed to download video: HTTP ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    return this.uploadVideoBuffer(buffer, videoId);
  }

  async uploadThumbnailBuffer(buffer: Buffer, videoId: string): Promise<string> {
    const privateObjectDir = this.getPrivateObjectDir();
    const objectEntityPath = `${privateObjectDir}/thumbnails/${videoId}.jpg`;
    const { bucketName, objectName } = parseObjectPath(objectEntityPath);
    const bucket = objectStorageClient.bucket(bucketName);
    const file = bucket.file(objectName);
    await file.save(buffer, { contentType: "image/jpeg", resumable: false });
    return `/objects/thumbnails/${videoId}.jpg`;
  }

  // Persist a single generated clip so it can be reused by a later remix without
  // regenerating it. Returns the /objects/... path stored on videos.clips.
  async uploadClipBuffer(buffer: Buffer, videoId: string, index: number): Promise<string> {
    const privateObjectDir = this.getPrivateObjectDir();
    const objectEntityPath = `${privateObjectDir}/clips/${videoId}/${index}.mp4`;
    const { bucketName, objectName } = parseObjectPath(objectEntityPath);
    const bucket = objectStorageClient.bucket(bucketName);
    const file = bucket.file(objectName);
    await file.save(buffer, { contentType: "video/mp4", resumable: buffer.length > 5 * 1024 * 1024 });
    return `/objects/clips/${videoId}/${index}.mp4`;
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
