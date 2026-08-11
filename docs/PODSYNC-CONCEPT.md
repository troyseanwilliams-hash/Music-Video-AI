# PodSync — Sister Site Concept

*A working name, not a confirmed brand — check domain/trademark availability before committing to it.*

## Positioning

AI Beat Sync turns a **song** into a beat-synced video. PodSync turns a **podcast episode** into share-ready
social clips — audiograms with animated waveforms, burned-in captions, and AI-picked highlight moments.

Same underlying muscle (audio in, polished short-form video out), completely different audience: podcasters,
interview shows, YouTube-to-podcast crossposters, and the networks/agencies that manage them. Almost no
overlap with AI Beat Sync's musician base, which makes this additive rather than cannibalizing — and it's a
much bigger addressable market (there are vastly more active podcasts than musicians actively releasing beat-synced videos).

## Core product loop

1. **Bring an episode** — upload audio/video, or paste an RSS/Spotify/Apple Podcasts/YouTube episode link
   (same "paste a link, we pull the file" pattern as the existing Suno-import flow in `generate.tsx`).
2. **Transcribe** — automatic speech-to-text with speaker labels.
3. **Find the moment** — AI scans the transcript and suggests 3–8 clip-worthy quotes/moments with timestamps
   (a punchy soundbite, a laugh, a strong opinion), or the user scrubs and picks their own.
4. **Generate the clip** — animated waveform (or a simple background/host photo), burned-in captions styled to
   the selected preset, episode branding (logo, name), sized for the target platform.
5. **Export everywhere** — vertical (TikTok/Reels/Shorts), square (Instagram feed), and a Spotify-Canvas-style
   loop, all in one pass — mirrors AI Beat Sync's existing Release Kit multi-format export.

## Site map

| Page | Purpose |
|---|---|
| Home | Marketing page — same structural pattern as `home.tsx`: hero, 3-step "how it works," sample clip reel, pricing teaser. |
| Generate | Paste/upload episode → transcript preview → highlight picker (AI-suggested + manual scrub). |
| Clip Studio | Remix-Lab-equivalent: trim in/out, caption style, waveform style, branding/logo placement, live preview. |
| Dashboard | Job history, clip library, credit balance, "Something of the Day"-style podcast tip widget. |
| Pricing | Credits + subscription tiers (see below). |
| Admin | Job approval/monitoring, user/credits management — same tab pattern as the existing `admin.tsx`. |

## Pricing concept

Audiogram clips are computationally *much* cheaper to produce than AI-generated video (no generative video
model in the critical path for the base tier — mostly transcription + deterministic waveform rendering), so
the pricing can be more generous than AI Beat Sync's to drive adoption and virality:

- **Free** — 3 clips/month, 720p, "Made with PodSync" watermark (same growth mechanic as AI Beat Sync's free
  watermarked tier).
- **Creator** — ~$12–15/mo, unlimited clips up to N episodes/month, no watermark, custom branding, 1080p.
- **Studio/Network** — for podcast networks and agencies managing multiple shows: team seats, multiple show
  profiles, priority processing, bulk/batch clip generation from a full back catalog. This is the highest-margin
  tier and the one most worth a direct sales motion.
- **Pay-as-you-go top-ups** — same credit-pack pattern as the recently-added $5/250-credit AI Beat Sync pack,
  for occasional users who don't want a subscription.

## Backend reuse vs. net-new

**Reuse directly (minimal or no change):**
- Job queue/worker architecture (`jobProcessor.ts` pattern) — add a new job type, same polling/retry/heartbeat scaffolding.
- Upload + presigned-URL flow (`presignAndUpload`/object storage pattern from `editor.tsx`).
- Credits + Stripe billing scaffolding (`STATIC_PLANS`, checkout, webhook credit-granting) — new product line under the same billing architecture.
- ffmpeg pipeline and transition/crossfade logic from `editorStitcher.ts` — captions and waveform are just another filter-graph layer on the same rendering approach.
- Admin dashboard tab pattern (`admin.tsx`, `admin-jobs.ts`) — add a "PodSync jobs" tab or a fully separate but structurally identical admin.
- Email/SMS admin-alert infra (`notifications.ts`, `renderEmail.ts`) — reused as-is.
- Referral system pattern (`ReferEarnCard`, `referralsTable`).
- The "Something of the Day" rotation pattern — reused for a podcast-specific tip/fact rotation on the dashboard.
- **Pixazo's model catalog already includes speech tooling** — OpenAI Whisper, AssemblyAI, Deepgram (speech-to-text), and a dedicated Speaker Diarization API — all reachable through the same gateway/auth pattern already wired up in `videoApis.ts`/`musicApis.ts`. This is the single biggest reuse win: no new vendor integration needed for transcription.
- The existing Anthropic fetch pattern (`promptBuilder.ts`/`lyricsGen.ts`) — reused for the "find the best quotable moment" highlight-detection prompt and for auto-writing clip titles/captions.

**Net-new:**
- A `speechApis.ts`-style wrapper calling Pixazo's Whisper/AssemblyAI/Deepgram/diarization endpoints — new code, but no new vendor relationship.
- Waveform-animation rendering (ffmpeg's `showwaves`/`showspectrum` filters, or a lightweight canvas renderer) — genuinely new, but deterministic signal processing, not generative AI, so it's cheap and fast.
- Caption burn-in styling UI (font/style presets, karaoke-style word highlighting is a common audiogram feature).
- The highlight-detection prompt template and its UI (transcript viewer + suggested-moment picker).
- New marketing site content, new pricing copy, new brand assets.
- A decision on account/billing separation (see below) — whichever way it goes, some new plumbing either way.

## Brand & account strategy — one open decision

**Option A — fully separate:** new domain, new signup, own credit wallet. Cleanest positioning for selling into
podcast networks (no "music video" association to explain away), simplest to reason about, but no cross-sell
without extra work and it's two logins to maintain.

**Option B — shared backend, separate front door:** same `api-server` monorepo, new route namespace
(`/api/podsync/*`), optionally single sign-on so one account can access both products — either sharing one
credit pool or keeping two separate balances under one login. Maximizes reuse and lets you cross-promote
("also try PodSync" in the AI Beat Sync nav and vice versa) without duplicating auth/billing infrastructure.

Recommendation: **Option B**, but with genuinely separate marketing sites and pricing pages — same company,
same login, distinct product identity. It gets you the infrastructure leverage without confusing either
audience about what the product is for.

## Rough MVP scope (first cut, not full spec)

1. Upload/paste-link → transcript (Whisper via Pixazo) → basic waveform clip export, no AI highlight-picking yet (manual scrub only).
2. One caption style, one waveform style, vertical export only.
3. Credits reused from the existing billing scaffolding under a new low-cost product line.
4. AI highlight suggestions, multi-format export, and branding customization as fast-follow, not launch blockers.
