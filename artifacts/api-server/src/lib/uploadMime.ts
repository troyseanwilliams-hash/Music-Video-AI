const CONTENT_TYPE_EXT: Readonly<Record<string, string>> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/ogg": "ogg",
  "application/ogg": "ogg",
  "audio/flac": "flac",
  "audio/x-flac": "flac",
  "audio/webm": "webm",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/x-matroska": "mkv",
  "video/x-msvideo": "avi",
  "video/x-ms-wmv": "wmv",
  "video/3gpp": "3gp",
  "video/mp2t": "ts",
  "video/ogg": "ogv",
  "video/x-m4v": "m4v",
  "video/m4v": "m4v",
};

export function extensionForUploadContentType(contentType?: string | null): string | undefined {
  return contentType ? CONTENT_TYPE_EXT[contentType.toLowerCase()] : undefined;
}