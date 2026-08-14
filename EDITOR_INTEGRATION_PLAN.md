# AIBeatSync — Editor ("Studio") Integration Plan

Bringing the Splicer timeline editor into aibeatsync.com as a first-class feature: a
**user-controlled version of the stitching you already do automatically.** Users arrange
AI-generated clips (and their own footage/photos) on a timeline, add music and transitions,
preview, and export a finished MP4.

This plan maps the editor onto the **existing** architecture rather than bolting on a separate
app, so it inherits your auth, storage, job pipeline, credits, and billing.

---

## 1. Why this fits

You already have the hard parts:

| Need | Already in the repo |
|------|---------------------|
| FFmpeg assembly | `artifacts/api-server/src/lib/videoStitcher.ts` (fluent-ffmpeg) |
| Long-running render jobs | Job pipeline `queued → analyzing → generating → stitching → ready` + dedicated `worker` |
| File storage | `lib/object-storage-web` + `objectStorage.ts` (Replit App Storage / GCS) |
| Auth gating | custom auth, `authMiddleware.ts`, `useAuth()` |
| Metering & billing | `credits` table, `creditCost.ts`, Stripe (`stripe-replit-sync`) plans Starter/Pro/Studio |
| Design system | React + Vite + wouter + shadcn/ui (`@/components/ui`) |

The editor reuses all of it. The new surface area is: one timeline **page**, one new **job type**,
an **extended stitcher**, and the **credit/tier rules** for exports.

---

## 2. Product positioning & cohesive UX

Call it **Studio** (or "Editor") in the nav, alongside Generate / Gallery / Dashboard.

Two entry points, one experience:

1. **Handoff from the generator (most cohesive).** On a finished job (`job-status.tsx`) and in
   `gallery.tsx`, add an **"Open in Studio"** button that loads those clips onto the timeline,
   pre-filled with the original song. Users go: *generate → tweak the cut → export.*
2. **Standalone Studio page** (`/studio`): upload any clips/photos + a track and assemble from
   scratch. Broadens the product beyond pure AI generation (creators with their own footage).

Branding cohesion: the editor uses your existing shadcn tokens (`--primary` = your `#FF3C00`
orange, `--background`, `--card`, etc.) and the shared `Navbar`/`Footer`, so it looks native —
not the standalone Splicer purple/teal.

Studio capabilities (ported from Splicer, restyled):
- Wrapping filmstrip timeline (drag-reorder, click-to-jump, per-photo duration).
- In-app preview with playback + transitions (crossfade, fade-to-black, wipe, slide, circle).
- Music track with mix/replace + volume.
- Skip-on-error rendering, auto-cleanup, single "Export & download" action.

---

## 3. Architecture mapping (files to add / change)

### Backend — `artifacts/api-server` + `artifacts/worker`
- **Extend `videoStitcher.ts`** into a shared `editorStitcher.ts` (lives in both, like the existing
  duplicated `jobProcessor`/`videoStitcher`): adds (a) **photo segments** (loop a still for N
  seconds), (b) **transitions** (xfade/acrossfade chain — already prototyped in Splicer's
  `render.js`), (c) **user-defined order/durations**, (d) **skip-on-failure**. The current
  `stitchVideoClips` becomes a special case (hard cut, AI-chosen order).
- **New job type `editor_render`** on the existing `jobs` pipeline. The worker's `jobProcessor`
  gains a branch: if `job.type === 'editor_render'`, pull the project manifest, fetch input
  objects from storage, call `editorStitcher`, upload the result to
  `/objects/videos/<videoId>.mp4`, and write a `videos` row — identical to the AI path's tail end.
- **New routes** in `routes/` (e.g. `studio.ts`): `POST /api/studio/projects` (save manifest),
  `POST /api/studio/render` (credit-check + enqueue job), reusing the SSE/polling job-status that
  already exists. Asset upload reuses `routes/storage.ts` presigned uploads.

### Data model — `lib/db/src/schema/beatvision.ts`
- Add `type` (`'ai' | 'editor_render'`, default `'ai'`) and `manifest` (`jsonb`) columns to
  `jobsTable`, **or** add a small `editor_projects` table keyed to `userId` holding the timeline
  manifest (segments: ordered list of `{objectPath, kind, durationSec}`, `music`, `transition`,
  `transitionDuration`). Recommend the dedicated table so projects can be re-opened/edited.
- Push with `pnpm --filter @workspace/db run push`.

### API contract — `lib/api-spec` → `lib/api-client-react`
- Add the Studio endpoints + `EditorProject` / `CreateRenderRequest` schemas to the OpenAPI spec
  (source of truth), then `pnpm --filter @workspace/api-spec run codegen` to regenerate the
  React Query hooks the frontend consumes.

### Frontend — `artifacts/beatvision`
- New page `src/pages/studio.tsx` + route in `App.tsx` (`/studio`), gated by `useAuth()`.
- Port the Splicer timeline/preview into React components under `src/components/studio/*`
  (Timeline, PreviewStage, TransitionPicker, MusicPicker, ExportBar) using shadcn primitives.
- Upload via the existing `ObjectUploader` (Uppy) from `lib/object-storage-web`.
- "Open in Studio" buttons in `gallery.tsx` and `job-status.tsx`.

---

## 4. Feature tiers & pricing

Two viable models. **Recommendation: credits (Option A)** — it reuses your metering, ties Studio to
the same balance users already top up, and reflects that an FFmpeg render is *cheap to deliver*
(no Runway/Luma token cost), so exports should cost far less than AI generation.

### Option A — Credit-metered exports (recommended)
A Studio export is a CPU render with **no AI provider cost**, so price it as a small flat fee plus
a modest scale for length/resolution. At `USD_PER_CREDIT = 0.02`:

| Export | Credits | ≈ USD | Rationale |
|--------|---------|-------|-----------|
| Up to 1 min, 720p | 15 | $0.30 | covers compute + margin |
| Up to 3 min, 1080p | 40 | $0.80 | |
| 3 min+, or 1080p with transitions | 75 | $1.50 | xfade re-encodes the whole timeline |

Add a `calculateEditorCost(durationSec, resolution, hasTransitions)` alongside `creditCost.ts` and
gate `POST /api/studio/render` with the same `creditsRemaining` check used in `routes/jobs.ts`.
**Free preview, paid export** — building/previewing a project costs nothing; credits are only spent
on a successful export (refund credits if the render fails).

### Option B — Plan-tier gating (or layer on top of A)
Bundle Studio into existing subscriptions as added value, gating only the expensive dimensions:

| | Free | Starter $20 | Pro $45 | Studio $79 |
|---|---|---|---|---|
| Studio access | ✓ | ✓ | ✓ | ✓ |
| Max export length | 30s | 2 min | 5 min | 15 min |
| Resolution | 720p (watermark) | 1080p | 1080p | 1080p / 4K |
| Transitions | hard cut only | basic (fade) | all | all |
| Photos in timeline | – | ✓ | ✓ | ✓ |
| Priority render queue | – | – | ✓ | ✓ |
| Watermark | yes | no | no | no |

The **watermark on Free** doubles as growth marketing (every shared free export advertises AI Beat
Sync). Implement as a `drawtext`/overlay branch in the stitcher when `user.plan === 'free'`.

**Suggested launch:** ship Option A (credits) so it's live and self-serve, and use the Option B
length/resolution/watermark gates as the free-tier limits. Best of both: metered for paid users,
limited-but-free to drive adoption.

---

## 5. Phased delivery

1. **Phase 1 — Engine.** Extend the stitcher (photos + transitions + ordering + skip), add the
   `editor_render` worker branch, and `POST /api/studio/render` behind a credit check. Unit-test on
   sample assets. *Ship-ready backend with no UI.*
2. **Phase 2 — Studio page.** Port the timeline/preview to `studio.tsx` with shadcn styling, wired
   to upload + the render endpoint + job-status SSE. Gate by auth.
3. **Phase 3 — Handoff & polish.** "Open in Studio" from gallery/job-status, free-tier watermark +
   limits, credit cost surfaced in the UI (like the generator already does), pricing-page copy.
4. **Phase 4 — Save/reopen projects** (the `editor_projects` table) and per-clip trimming.

---

## 6. Open decisions for you
- **Pricing model:** credits (A), tiers (B), or the hybrid recommended above?
- **Project persistence:** add columns to `jobs`, or a dedicated `editor_projects` table (recommended)?
- **Watermark on Free:** yes/no, and exact placement/branding.
- **Naming:** "Studio" vs "Editor" in the nav.

Tell me which to lock in and I'll start Phase 1 directly in the repo, following your existing
patterns (Drizzle schema → OpenAPI spec → Orval codegen → worker job → route → page).

---

## 7. Runway API enhancements (product quality + promotional material)

You currently call **Runway Gen-3 Turbo** (`videoApis.ts`, `RUNWAY_API_KEY`). Runway's API has moved
on significantly as of June 2026, and several upgrades both improve the generated clips *and* unlock
a near-free pipeline for marketing assets — especially powerful when paired with the new Studio editor
(you can assemble the promo reel in your own product).

### Worth adopting in the integration
- **Upgrade Gen-3 Turbo → Gen-4 / Gen-4.5.** Gen-4 brings *world consistency* — consistent
  characters, locations, and objects across scenes — plus better motion coherence and up to 60s /
  4K. For beat-synced videos this means a recognizable look that holds across the 3-clip stitch
  instead of three unrelated shots. Gen-4 handles image-to-video; Gen-4.5 handles text-to-video.
  This is a drop-in model-string change in `videoApis.ts` plus ratio/option mapping.
- **Aleph 2.0 (video-to-video editing, June 2026).** Edit an existing video with a text prompt and
  optional **keyframe images at specific timestamps** (2–30s input, up to 5 keyframes). This is the
  big one for promos: take any base clip and restyle/brand it, or insert product moments at exact
  beats. Pairs naturally with the editor's transition timeline.
- **Motion Brush 3.0.** Paint exactly which regions move and how (speed/direction vectors) — gives
  art-directable hero shots for ads instead of whole-frame motion.
- **Reference-image consistency.** You already store a `referenceImagePath` / `promptImage`; Gen-4's
  consistency makes that far stronger — feed your logo/brand frame and get on-brand motion every time.

### Using Runway specifically for promotional material
The economics fit marketing (low volume, high quality) even though they'd be steep per-user at scale:
Gen-4 runs about **$0.05/credit, ≈ $6 per 10-second clip** — trivial for a controlled set of ad assets.

Concrete promo pipeline (dogfooding your own stack):
1. Generate a small library of **on-brand Gen-4 clips** (same character/scene via world consistency)
   in the AIBeatSync orange aesthetic.
2. **Assemble them in Studio** with one of your tracks, beat-synced cuts, and transitions — the exact
   feature you're launching, so the promo *demonstrates the product.*
3. Use **Aleph 2.0** to spin variants (9:16 for TikTok/Reels, 1:1 for IG, 16:9 for YouTube pre-roll)
   and to drop in text/product beats at timestamps.
4. Auto-watermark-free exports for owned channels; the free-tier watermark advertises on user shares.

This also creates a flywheel: a "**Make a promo from your video**" template inside Studio (pre-set
aspect ratios + captions) lets *users* produce shareable, branded clips — organic marketing.

### Suggested Runway work items
- Bump model to Gen-4/Gen-4.5 in `videoApis.ts`; add a `model`/quality option to `CreateJobRequest`
  and the generator toolbar (Standard = Gen-3 Turbo for cost, High = Gen-4).
- Add an **Aleph "restyle/edit"** path (new job sub-type) for video-to-video — powers both user edits
  and promo variants.
- Re-tune `creditCost.ts` for Gen-4's higher token/credit cost so margins hold; expose the price delta
  in the UI like you already do.
- Note Runway now ships official **Python + Node SDKs** with typed async jobs — cleaner than raw REST
  if you refactor `videoApis.ts`.

> Confirm the exact current model strings/limits against Runway's live docs before wiring (`docs.dev.runwayml.com`),
> since model names and per-credit pricing shift frequently.

Sources: [Runway API docs](https://docs.dev.runwayml.com/) · [Runway Gen-4 research](https://runwayml.com/research/introducing-runway-gen-4) · [Runway API](https://runwayml.com/api) · [Runway changelog](https://runwayml.com/changelog)
