import { execFile } from "child_process";
import { randomUUID } from "crypto";
import { writeFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";

export const IMAGE_API_FAILURE = "[IMAGE_API_FAILURE]";
export const IMAGE_POLL_TIMEOUT = "[IMAGE_POLL_TIMEOUT]";
const execFileAsync = promisify(execFile);

export interface NarrativeImageRequest {
  prompt: string;
  aspectRatio?: string | null;
  referenceImageUrl?: string | null;
  existingPollUrl?: string | null;
  onSubmit?: (info: { requestId: string; pollUrl: string }) => void | Promise<void>;
  onUncertainSubmission?: (info: {
    status?: number;
    activityId?: string;
    reason: string;
  }) => void | Promise<void>;
}

function imageSizeForAspectRatio(aspectRatio?: string | null): string {
  switch (aspectRatio) {
    case "9:16":
      return "portrait_16_9";
    case "4:3":
      return "portrait_4_3";
    case "1:1":
      return "square_hd";
    case "21:9":
    case "16:9":
    default:
      return "landscape_16_9";
  }
}

export function singleSceneImagePrompt(segmentPrompt: string): string {
  const outputRule = [
    "CRITICAL OUTPUT RULE: Generate exactly one image for exactly one requested segment.",
    "Show one continuous moment in one setting from one camera view.",
    "Do not combine multiple moments, scenes, locations, camera angles, or requested segments.",
    "Do not create a collage, triptych, diptych, grid, contact sheet, split screen, panels, montage, storyboard, or multi-frame composition.",
    "If the brief mentions other events, show only the single current segment for this request.",
  ].join("\n");
  const maxSegmentLength = Math.max(0, 3000 - outputRule.length - 2);
  return [segmentPrompt.trim().slice(0, maxSegmentLength), outputRule].join("\n\n");
}

export async function generateNarrativeImage(req: NarrativeImageRequest): Promise<string> {
  const key = process.env.PIXAZO_API_KEY;
  if (!key) throw new Error(`${IMAGE_API_FAILURE} AI image generation is not configured.`);

  let pollUrl = req.existingPollUrl?.trim() ?? "";
  if (!pollUrl) {
    const model = process.env.PIXAZO_NARRATIVE_IMAGE_MODEL?.trim() || "flux-2-max";
    const endpoint = `https://gateway.pixazo.ai/${model}/v1/${model}-request`;
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
          "Ocp-Apim-Subscription-Key": key,
        },
        body: JSON.stringify({
          prompt: singleSceneImagePrompt(req.prompt),
          image_size: imageSizeForAspectRatio(req.aspectRatio),
          input_image: req.referenceImageUrl?.trim() || undefined,
          safety_tolerance: "2",
          enable_safety_checker: true,
          output_format: "jpeg",
          sync_mode: false,
        }),
        signal: AbortSignal.timeout(90_000),
      });
    } catch (error) {
      await req.onUncertainSubmission?.({
        reason: `Image submission transport error: ${error instanceof Error ? error.message : String(error)}`.slice(0, 240),
      });
      throw new Error(`${IMAGE_API_FAILURE} The AI image service did not confirm the scene request.`);
    }

    const text = await response.text();
    if (!response.ok) {
      let activityId: string | undefined;
      try {
        const data = JSON.parse(text) as { activityId?: unknown };
        if (typeof data.activityId === "string") activityId = data.activityId.slice(0, 120);
      } catch {
        // Provider errors are not guaranteed to be JSON.
      }
      if (response.status >= 500) {
        await req.onUncertainSubmission?.({
          status: response.status,
          activityId,
          reason: `AI image service returned HTTP ${response.status}`,
        });
        throw new Error(`${IMAGE_API_FAILURE} Service temporarily unavailable.`);
      }
      throw new Error(`${IMAGE_API_FAILURE} AI image service ${response.status}: ${text.slice(0, 200)}`);
    }

    let data: { request_id?: unknown; polling_url?: unknown };
    try {
      data = JSON.parse(text) as { request_id?: unknown; polling_url?: unknown };
    } catch {
      await req.onUncertainSubmission?.({ reason: "AI image service returned an unreadable success response" });
      throw new Error(`${IMAGE_API_FAILURE} The AI image service response could not be verified.`);
    }
    const requestId = typeof data.request_id === "string" ? data.request_id.trim() : "";
    if (!requestId) {
      await req.onUncertainSubmission?.({ reason: "AI image service returned success without a request id" });
      throw new Error(`${IMAGE_API_FAILURE} The AI image service did not return a scene request id.`);
    }
    pollUrl =
      typeof data.polling_url === "string" && data.polling_url.trim()
        ? data.polling_url
        : `https://gateway.pixazo.ai/v2/requests/status/${requestId}`;
    await req.onSubmit?.({ requestId, pollUrl });
  }

  for (let attempt = 0; attempt < 120; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    let poll: Response;
    try {
      poll = await fetch(pollUrl, {
        headers: { "Ocp-Apim-Subscription-Key": key },
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      // The paid request is already persisted. A single network timeout while
      // checking it must not fail/refund the whole render; keep polling the same
      // request so a retry never submits and pays for a duplicate image.
      if (attempt === 119) {
        throw new Error(`${IMAGE_POLL_TIMEOUT} The source-image request status could not be confirmed.`);
      }
      continue;
    }
    if (!poll.ok) continue;
    let result: {
      status?: string;
      error?: string | null;
      output?: { media_url?: string[] };
    };
    try {
      result = await poll.json() as typeof result;
    } catch {
      if (attempt === 119) {
        throw new Error(`${IMAGE_POLL_TIMEOUT} The source-image status response could not be verified.`);
      }
      continue;
    }
    if (result.status === "COMPLETED" && result.output?.media_url?.[0]) return result.output.media_url[0];
    if (result.status === "FAILED" || result.status === "ERROR") {
      throw new Error(`${IMAGE_API_FAILURE} AI image generation failed: ${result.error ?? "unknown error"}`);
    }
  }
  throw new Error(`${IMAGE_POLL_TIMEOUT} AI image generation timed out.`);
}

async function assertDecodableImage(buffer: Buffer): Promise<void> {
  const path = join(tmpdir(), `beatsync-image-check-${randomUUID()}.img`);
  try {
    await writeFile(path, buffer);
    await execFileAsync(
      "ffmpeg",
      ["-v", "error", "-i", path, "-map", "0:v:0", "-frames:v", "1", "-f", "null", "-"],
      { timeout: 30_000, maxBuffer: 256 * 1024 },
    );
  } catch {
    throw new Error(`${IMAGE_API_FAILURE} The generated source image was invalid and was not added.`);
  } finally {
    await unlink(path).catch(() => {});
  }
}

export async function downloadGeneratedImage(url: string): Promise<Buffer> {
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  } catch {
    throw new Error(`${IMAGE_API_FAILURE} The completed source image could not be downloaded.`);
  }
  if (!response.ok) throw new Error(`${IMAGE_API_FAILURE} Could not download generated image: HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  await assertDecodableImage(buffer);
  return buffer;
}