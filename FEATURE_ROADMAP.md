# AI Beat Sync — Feature Roadmap

Ordered build plan for the features from the site review. **Ship one unit at a
time, top to bottom.** Each unit is self-contained: it lists goal, scope, files,
steps, data/migrations, and acceptance criteria so any session can resume by
picking the next unchecked item — no prior context needed.

## Conventions (read once)
- Monorepo: `lib/db` (Drizzle schema), `lib/api-spec/openapi.yaml` (+ generated
  `lib/api-zod`, `lib/api-client-react`), `artifacts/api-server`, `artifacts/worker`
  (keep the two `jobProcessor.ts` / `videoApis.ts` / stitcher copies in lockstep),
  `artifacts/beatvision` (React frontend).
- DB change → edit `lib/db/src/schema/beatvision.ts`, then `pnpm --filter @workspace/db run push` (+ a raw SQL fallback in `scripts/`).
- API field → edit `openapi.yaml`, run codegen, or hand-mirror into `lib/api-zod` + `lib/api-client-react` (as done for `aiProvider`).
- After each unit: `pnpm check` (typecheck), manual smoke test, then zip changed files.
- Keep credit costs in sync: server `artifacts/api-server/src/lib/creditCost.ts` ↔ frontend `artifacts/beatvision/src/lib/creditPricing.ts`.

## Progress
- [x] 1. Beat-snapped cutting in Remix Lab  *(v1: auto-detect BPM from added music + "Sync photos to beat")*
- [x] 2. Lyric-video mode (auto-timed lyrics)  *(v1: even line-timed drawtext burn in videoStitcher, both copies)*
- [x] 3. Faster first "aha" — demo song + templates  *(templates live; demo song needs `public/demo-song.mp3`)*
- [x] 4. Platform export presets  *(generate page: TikTok/YouTube/Canvas/Square set aspect+duration)*
- [ ] 5. Style variations pass
- [ ] 6. Render-finished notifications
- [x] 7. Referral / share-to-earn credits  *(shipped: codes, ?ref capture, idempotent grants, dashboard panel)*
- [ ] 8. Contextual upsells + premium (4K/commercial) tier
- [ ] 9. Creator mini-dashboard (views/likes)
- [~] 10. SEO style landing pages  *(partial: /suno + /spotify-canvas live with meta + internal links)*

---

## 1. Beat-snapped cutting in Remix Lab  *(highest impact — the core differentiator)*
**Goal:** Auto-cut a Remix Lab timeline of photos/clips to the song's beat; snap manual cut points to the nearest beat.
**Scope in:** "Auto-edit to the beat" button; beat grid overlay on the timeline; snap-on-drag. **Out:** transitions redesign, multi-track.
**Data:** Beat timestamps. Reuse `audioAnalysis` (BPM already computed). If beat times aren't stored, derive a grid from `bpm` + first-downbeat offset; ideally extend analysis to emit `beats: number[]`.
**Files:** `artifacts/api-server/src/lib/audioAnalysis.ts` (+ worker copy) → return beat times; `openapi.yaml` `AudioAnalysis` (+ regen); `artifacts/beatvision/src/pages/editor.tsx` (timeline + auto-cut logic); editor uses the analysis already fetched for the chosen track.
**Steps:** (a) Ensure beat timestamps are available (extend analysis or derive from BPM). (b) In editor, add "Sync to beat" → distribute segment boundaries onto beats (every beat / 2 / 4, user-selectable). (c) Snap drag handles to nearest beat; show faint beat ticks on the timeline. (d) Persist per-segment durations as today.
**Acceptance:** With a track loaded, one click re-times all segments to land on beats; dragging a boundary snaps to the grid; export reflects the new timing.
**Est.:** M–L.

## 2. Lyric-video mode (auto-timed lyrics)
**Goal:** Karaoke-style lyrics that appear in time with the music, as a generate option and/or Remix Lab overlay.
**Scope in:** paste lyrics → auto-distribute across the track (by section/beat), styled captions burned into the export. **Out:** word-level forced alignment (phase 2), multi-language.
**Data:** Timed lyric lines. v1: split `lyricsText` into lines and distribute evenly across `durationSeconds` (or across detected sections/beats from unit 1). v2: LRC import + optional forced-alignment service.
**Files:** stitcher (`editorStitcher.ts` both copies) or the AI render path — add a drawtext/subtitle burn step; `generate.tsx` + `editor.tsx` UI (enable "Lyric mode", style picker); `openapi.yaml` if a `lyricsTimed`/mode flag is added.
**Steps:** (a) Line-timing helper (even split → beat/section-aware). (b) ffmpeg subtitle/drawtext overlay with a couple of preset styles (bottom-center, karaoke highlight later). (c) UI toggle + preview note.
**Acceptance:** With lyrics entered and "Lyric mode" on, exported video shows lines changing roughly in sync; off = unchanged behavior.
**Est.:** M (v1), L (word-level v2).

## 3. Faster first "aha" — demo song + templates
**Goal:** New/trial users reach a result without hunting for audio or writing a prompt.
**Scope in:** "Try a demo song" (bundled royalty-free track) that pre-fills the generator; 4–6 starting templates (style + prompt + aspect + duration presets). **Out:** full template marketplace.
**Data:** static assets + a `TEMPLATES` config; no DB change. Add a demo audio file to `artifacts/beatvision/public/`.
**Files:** `artifacts/beatvision/src/pages/generate.tsx` (template chips + "demo song" button that sets state and skips upload), a `templates.ts` config, `home.tsx` (optional "Start from a template" CTA).
**Steps:** (a) Define templates. (b) Demo-song button loads the bundled track as the source (reuse the upload/analysis path or a preset objectPath). (c) Template chip applies style/prompt/aspect/duration in one click.
**Acceptance:** From a cold start, a user can click a template + demo song and reach the generate/confirm step in under ~10s with valid settings.
**Est.:** S–M.

## 4. Platform export presets
**Goal:** One-click sizing for TikTok/Reels/Shorts (9:16), YouTube (16:9), Spotify Canvas (9:16, 5s).
**Scope in:** preset selector that sets aspect ratio + duration together in generate and Remix Lab. **Out:** direct-to-platform publishing.
**Files:** `generate.tsx` (preset row above aspect/duration), `editor.tsx` (aspect/resolution presets), reuse existing aspect/resolution enums.
**Steps:** (a) `PLATFORM_PRESETS` map → {aspect, duration/resolution}. (b) Preset chips set both fields; keep manual controls. (c) Canvas preset ties to the existing 5s path.
**Acceptance:** Selecting "TikTok" sets 9:16; "Canvas" sets 9:16 + 5s; manual overrides still work.
**Est.:** S.

## 5. Style variations pass
**Goal:** Generate 2–3 style/prompt variations of a clip so users pick the best.
**Scope in:** "Generate N variations" (charges per variation); results shown side-by-side on job status. **Out:** infinite regen.
**Data:** either N separate jobs (simplest, reuses everything) or one job producing N candidate clips. Recommend **N separate jobs** tagged with a shared `batchId` (nullable `batch_id` on `jobs`).
**Files:** `lib/db` (`batch_id`), `routes/jobs.ts` (accept `variations`, create N jobs, charge N×), `generate.tsx` (variations selector + cost math via `creditPricing.ts`), `job-status.tsx`/gallery (group by batch).
**Acceptance:** Choosing 3 variations creates 3 jobs, deducts 3× credits, and the user can compare/keep results.
**Est.:** M.

## 6. Render-finished notifications
**Goal:** Email (and/or in-app) when a long job completes or fails.
**Scope in:** email on `ready`/`failed`, user opt-out setting. **Out:** web push (phase 2).
**Data:** reuse `notifications.ts` + existing email infra; add a `notifyOnComplete` user pref (nullable boolean) if opt-out desired.
**Files:** worker `jobProcessor.ts` completion/`retryOrFail` paths → enqueue email; `artifacts/api-server/src/lib/notifications.ts`; settings UI (dashboard/account).
**Acceptance:** Completing a job sends one email with a link to the video; failures notify with a retry link; respects opt-out; idempotent (no dup emails on retries).
**Est.:** S–M.

## 7. Referral / share-to-earn credits
**Goal:** Growth loop — reward shares/referrals with credits; leverage the free-tier watermark.
**Scope in:** per-user referral code, credit grant on referred signup (and/or on referred first paid), share links. **Out:** multi-tier affiliate payouts.
**Data:** `referral_code` on users; `referrals` table (referrerId, referredId, status, credited). Grant via the same `ensureCreditsRow`/grant path used by Stripe.
**Files:** `lib/db` (schema), new `routes/referrals.ts` (+ register), signup flow to capture `?ref=`, credit grant hook, a "Refer & earn" UI panel.
**Acceptance:** A shared link attributes a new signup to the referrer and grants credits once (idempotent, self-referral blocked).
**Est.:** M.

## 8. Contextual upsells + premium (4K/commercial) tier
**Goal:** Convert at the right moments; add a high-margin tier.
**Scope in:** low-credits nudge at empty states, annual-plan prompt, a premium tier (4K via Kling v3 / commercial license / longer videos). **Out:** dynamic pricing.
**Files:** `pricing.tsx` (new tier card — Stripe plan/price needed), `generate.tsx`/`dashboard.tsx` (contextual nudges), gating for 4K/commercial in `routes/jobs.ts` + `creditCost.ts`.
**Acceptance:** Users low on credits see a targeted upgrade CTA; a premium plan unlocks 4K/commercial and is enforced server-side.
**Est.:** M (excludes Stripe product setup, which is manual in the dashboard).

## 9. Creator mini-dashboard (views/likes)
**Goal:** Give creators a reason to publish and return.
**Scope in:** per-video view counter + existing `likeCount`, a small "Your public videos" stats view. **Out:** full analytics.
**Data:** add `view_count` to `videosTable`; increment on public watch (throttled/deduped).
**Files:** `lib/db` (`view_count`), gallery/explore/video-url path to bump views, a stats section on dashboard or gallery.
**Acceptance:** Public video views increment (not gamed by refresh spam), and creators see views + likes per video.
**Est.:** S–M.

## 10. SEO style landing pages
**Goal:** Compound organic traffic in the niche the meta tags already target.
**Scope in:** static, indexable pages per style/use-case ("AI anime music video", "AI lyric video generator", "Spotify Canvas maker") with sample videos + CTA; sitemap entries. **Out:** full CMS/blog.
**Files:** `artifacts/beatvision/src` new route pages + a small content config, `sitemap`/SEO wiring (matches existing meta setup), internal links from home/footer.
**Acceptance:** Each page renders unique title/meta/H1 + samples + CTA, is linked internally, and appears in the sitemap.
**Est.:** M (content-dependent).

---

## Notes on "exhausting usage"
- This file is the source of truth. To resume: open Progress, take the first
  unchecked unit, implement only that unit end-to-end, check it off, zip, stop.
- Don't batch multiple units — each is sized to fit a single working session.
- If a unit turns out larger than expected, split it in place (e.g., 2v1 vs 2v2)
  and check off the part that shipped.
