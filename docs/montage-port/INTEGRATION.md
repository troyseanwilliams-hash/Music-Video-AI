# Integration boundaries and acceptance checks

## 1. Editor and application shell

Mount the editor in the podcast app's existing authenticated navigation. Reuse its React Query, toast, dialog and routing providers. The supplied frontend dependency closure includes shared UI, onboarding and auxiliary dialogs so no editor-local imports are silently discarded.

The source uses React 19, Vite, TypeScript, Tailwind and Radix-based UI. Preserve the destination's shell; merge CSS/theme variables deliberately. Original signup, pricing, analytics, navigation, photo animation and AI lyric alignment are host integrations, not permission to change the podcast product's business rules.

Audit all `/api/` URLs in the editor, media pickers and `overlayTypes.ts`; route them through the destination's API base, including authenticated media playback. Do not hardcode the original project's host.

## 2. Identity, media and storage

Replace the source `useAuth`, server request user, gallery videos, saved images and soundtracks with the podcast application's equivalents.

Connect upload URLs, media reads and worker downloads to its storage service. Resolve object paths with server-side ownership checks for **every** video, image and audio slot on save and render. A client-supplied path or user ID is never authorization. Do not make private media public to simplify playback.

Use the source route's storage/ownership validation as a reference, not a copy of its database identities. No user files are transferred by this kit.

## 3. Saved projects and API

Preserve version-1 project manifests and all nested properties: segments, background music, overlays, text cards, audio clips, transitions, orientation and resolution. Audio fade settings and overlay layout/border/corner settings must survive save, reload, duplicate and export.

Merge the studio endpoints and their request/response schemas from the included OpenAPI file. Regenerate the destination client after merging. The source schema files are declarations, not a production migration: design a compatible migration for the podcast app's users/jobs/media tables.

Preserve current validation limits, including 30-minute timed layers, 100 slots per layer collection, four simultaneous layers within each supported type, and valid fade durations. Let included schemas be authoritative for exact bounds and defaults.

## 4. Queue and rendering

Adapt the `EditorManifest` and `processEditorJob` section in the reference job processor. It downloads owned media, calls `stitchEditorTimeline`, reports progress, stores output and handles completion/accounting. Do not copy the entire general-purpose AI worker into the podcast app.

Render asynchronously with a durable job ID and polling; never keep a web request open for FFmpeg. Preserve heartbeat/ownership fencing, cancellation, resource leases and bounded concurrency. `editorStitcher.ts` imports the database lease helper: provide the destination's equivalent, not an unconditional no-op.

Install FFmpeg/ffprobe with libx264, AAC, libass and required filters. Preserve renderer fonts and their licences. Use Node with writable temporary storage and enough memory for decode/encode; clean temporary files on success and failure.

The API and worker contain matching renderer copies. This kit includes both; keep them synchronized or migrate to one shared renderer package. The included core is exercised with real FFmpeg fixtures, but no destination deployment has been tested.

Missing main timeline media must fail an export with timed layers instead of shifting every later overlay. Keep overlays at their absolute timestamps. Contain source images/video without cropping away source watermarks.

## 5. Sound, layout and billing

Music-slot fades are local to the clip and must remain continuous across render chunks. While any nonzero-volume music slot is active, mute underlying audio; after the last active slot ends, restore it. Do not leave the preview permanently muted or let original audio leak into the exported music interval.

Centered 16:9 framing changes the overlay foreground, not the overall export orientation. Portrait exports also show blur above and below. Match preview and export for borders and corner rounding.

Source billing constants, free exports, lyric charges, watermark rules and trial controls are product-specific references. Use podcast entitlements and its existing credit authority. Preserve atomic debit/refund behavior and idempotent completion; do not charge AIBeatSync accounts from the podcast app.

## Acceptance checklist

- Upload video and images; select existing authorized media and reject another user's media.
- Save/reload projects with multiple distinct video, image and music time slots.
- Edit, duplicate and remove one slot without changing other slots.
- Verify white/gold/violet/cyan/none borders, custom widths, rounding and all existing layouts.
- Test centered 16:9 in landscape and portrait exports with landscape and portrait sources.
- Check transitions, trims, text cards, background music and lyric overlays still work.
- Check overlapping music, zero-volume clips, fades, pause/resume and scrubbing.
- Listen before/during/after music intervals in both preview and downloaded export.
- Verify audio and overlays across a renderer chunk boundary.
- Reject out-of-bounds durations/fades and missing media without shifting timing.
- Test job retry/failure/cancellation without duplicate charges or orphaned output.
- Verify desktop and mobile editor interactions with a signed-in test account.
- Run TypeScript checks and included tests; optional long-duration tests require explicit enabling per their source.

Original-workspace test commands (adapt package names and configuration after porting):

```sh
pnpm --filter @workspace/beatvision exec vitest run src/components/montage/OverlayStage.test.tsx src/components/montage/overlayTypes.test.ts src/components/montage/audioClips.test.tsx
pnpm --filter @workspace/api-server exec vitest run src/lib/editorLayers.test.ts src/lib/editorStitcher.test.ts
```
