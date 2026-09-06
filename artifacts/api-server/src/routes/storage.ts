import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage.js";
import { ObjectPermission } from "../lib/objectAcl.js";
import { db, imageAssetsTable, podcastJobsTable } from "@workspace/db";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { extensionForUploadContentType } from "../lib/uploadMime.js";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

/**
 * POST /storage/uploads/request-url
 *
 * Request a presigned URL for file upload.
 * The client sends JSON metadata (name, size, contentType) — NOT the file.
 * Then uploads the file directly to the returned presigned URL.
 */
router.post("/storage/uploads/request-url", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing or invalid required fields" });
    return;
  }

  try {
    const { name, size, contentType } = parsed.data;

    const ext = extensionForUploadContentType(contentType);

    const uploadURL = await objectStorageService.getObjectEntityUploadURL(ext, req.user.id);
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);

    res.json(
      RequestUploadUrlResponse.parse({
        uploadURL,
        objectPath,
        metadata: { name, size, contentType },
      }),
    );
  } catch (error) {
    req.log.error({ err: error }, "Error generating upload URL");
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

/**
 * GET /storage/public-objects/*
 *
 * Serve public assets from PUBLIC_OBJECT_SEARCH_PATHS.
 * These are unconditionally public — no authentication or ACL checks.
 * IMPORTANT: Always provide this endpoint when object storage is set up.
 */
router.get("/storage/public-objects/*filePath", async (req: Request, res: Response) => {
  try {
    const raw = req.params.filePath;
    const filePath = Array.isArray(raw) ? raw.join("/") : raw;
    const file = await objectStorageService.searchPublicObject(filePath);
    if (!file) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    const response = await objectStorageService.downloadObject(file);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    req.log.error({ err: error }, "Error serving public object");
    res.status(500).json({ error: "Failed to serve public object" });
  }
});

/**
 * GET /storage/objects/*
 *
 * Serve object entities from PRIVATE_OBJECT_DIR.
 * These are served from a separate path from /public-objects and can optionally
 * be protected with authentication or ACL checks based on the use case.
 * Supports HTTP Range requests for video streaming.
 */
router.get("/storage/objects/*path", async (req: Request, res: Response) => {
  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;

    // New direct uploads and imported audio are stored below an owner namespace.
    // Treat a mismatched owner exactly like a missing object so opaque paths do
    // not become a cross-account read capability.
    if (wildcardPath.startsWith("uploads/") || wildcardPath.startsWith("audio/")) {
      const [, ownerId] = wildcardPath.split("/");
      if (ownerId && (wildcardPath.startsWith(`uploads/${ownerId}/`) || wildcardPath.startsWith(`audio/${ownerId}/`))) {
        if (!req.isAuthenticated() || ownerId !== req.user.id) {
          res.status(404).json({ error: "Object not found" });
          return;
        }
      }
    }

    // Image packs remain private unless explicitly published. A public row is
    // the ACL; knowing an opaque path alone never grants access.
    if (
      wildcardPath.startsWith("image-packs/")
      || wildcardPath.startsWith("narrative-images/")
    ) {
      const [asset] = await db
        .select({ id: imageAssetsTable.id })
        .from(imageAssetsTable)
        .where(and(
          eq(imageAssetsTable.objectPath, `/objects/${wildcardPath}`),
          isNull(imageAssetsTable.deletedAt),
          or(
            eq(imageAssetsTable.isPublic, true),
            req.isAuthenticated()
              ? eq(imageAssetsTable.userId, req.user.id)
              : undefined,
          ),
        ))
        .limit(1);
      if (!asset) {
        res.status(404).json({ error: "Object not found" });
        return;
      }
    }

    // Podcast renders are always private. Do not redirect these files to a
    // signed URL before proving the requesting user owns the exact persisted
    // output path; opaque podcast IDs are not an authorization mechanism.
    if (wildcardPath.startsWith("podcasts/")) {
      if (!req.isAuthenticated()) {
        res.status(404).json({ error: "Object not found" });
        return;
      }
      const objectPath = `/objects/${wildcardPath}`;
      const [podcast] = await db
        .select({ id: podcastJobsTable.id })
        .from(podcastJobsTable)
        .where(and(
          eq(podcastJobsTable.userId, req.user.id),
          or(
            eq(podcastJobsTable.fullVideoPath, objectPath),
            eq(podcastJobsTable.previewPath, objectPath),
            eq(podcastJobsTable.thumbnailPath, objectPath),
            sql`${podcastJobsTable.clipPaths} @> ${JSON.stringify([objectPath])}::jsonb`,
          ),
        ))
        .limit(1);
      if (!podcast) {
        res.status(404).json({ error: "Object not found" });
        return;
      }
    }

    // Stream master and optimized-preview MP4s directly from object storage.
    // Proxying long preview files through this API adds latency to every Range
    // request and can make a lower-bitrate rendition stutter anyway.
    if (
      wildcardPath.endsWith(".mp4")
      && (
        wildcardPath.startsWith("videos/")
        || wildcardPath.startsWith("video-previews/")
      )
    ) {
      const signedUrl = await objectStorageService.getObjectEntitySignedUrl(
        `/objects/${wildcardPath}`,
        3600,
      );
      res.setHeader("Cache-Control", "no-store");
      res.redirect(302, signedUrl);
      return;
    }

    const objectPath = `/objects/${wildcardPath}`;
    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);

    const rangeHeader = req.headers.range;
    let parsedRange: { start: number; end?: number } | undefined;
    if (rangeHeader) {
      const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
      if (match) {
        parsedRange = {
          start: parseInt(match[1], 10),
          end: match[2] ? parseInt(match[2], 10) : undefined,
        };
      }
    }

    const response = await objectStorageService.downloadObject(objectFile, 3600, parsedRange);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      req.log.warn({ err: error }, "Object not found");
      res.status(404).json({ error: "Object not found" });
      return;
    }
    req.log.error({ err: error }, "Error serving object");
    res.status(500).json({ error: "Failed to serve object" });
  }
});

export default router;
