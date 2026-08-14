# AIPodSync — Sister Site Concept

**Confirmed brand:** AIPodSync — **domain: aipodsync.com** (secured/available, matches the "AI ___ Sync"
naming family alongside AIBeatSync).

## Decision log (as of this revision)

- **Target the smaller, less-contested pie on purpose.** Market research (see "Market reality" below) found
  the broad "AI clip your long-form content" category is already dominated by a well-funded leader (OpusClip —
  ~$50M raised, $215M valuation, 10M+ users) plus a crowded second tier (Vizard, Descript, Riverside,
  ClipSpeedAI, Reap, Clouted). That entire tier is built around **video-recorded** source content. The
  narrower **audio-only podcast → audiogram** niche (the Headliner/Wavve lane) is smaller but meaningfully
  less contested — that's the deliberate wedge for AIPodSync, not a head-on OpusClip competitor.
- **This is a suite play, not a standalone bet.** AIPodSync exists to sit next to AIBeatSync as a second
  product in an "AI ___ Sync" family — shared backend/account infrastructure, separate front-facing brand,
  built specifically so the two properties can cross-promote to each other's audiences at near-zero
  incremental CAC rather than needing to out-market a $215M-funded competitor for cold traffic.

## Positioning

AIBeatSync turns a **song** into a beat-synced video. AIPodSync turns a **podcast episode** into
share-ready social clips — audiograms with animated waveforms, burned-in captions, and AI-picked highlight
moments — deliberately scoped to audio-first podcasts rather than competing with video-clipping incumbents.

Same underlying muscle (audio in, polished short-form video out), a different but adjacent audience:
podcasters, interview shows, and the networks/agencies that manage them. Little overlap with AIBeatSync's
musician base, which makes this additive rather than cannibalizing, and it plugs into a real, still-growing
market (4.8M active podcasts, 584M+ global listeners in 2026) even scoped down to the audio-first niche.

## Market reality (researched)

- **The overall pie is large and real:** ~4.8M active podcasts globally (2026), 584M listeners growing to an
  estimated 619M by year-end, 58% of Americans 12+ are monthly listeners (~167M people). Global podcasting
  market valued around $50.8B in 2026; podcast ad revenue ~$5B globally, up 20% YoY.
- **The clipping-tool category is not empty — it has an incumbent leader:** OpusClip ($215M valuation, 10M+
  users, 172M+ clips generated) dominates general AI video-to-clips. Vizard, Descript, Riverside, Headliner,
  Wavve, ClipSpeedAI, Reap, and Clouted round out a genuinely crowded field.
- **The differentiated slice:** most of that field assumes a video-recorded source (Zoom/Riverside-style
  podcasts already on YouTube). Audio-only podcast audiograms specifically (Headliner/Wavve's lane) are a
  smaller sub-market but far less contested — the intentional target here, not the whole category.

## Core product loop

1. **Bring an episode** — upload audio/video, or paste an RSS/Spotify/Apple Podcasts/YouTube episode link
   (same "paste a link, we pull the file" pattern as the existing Suno-import flow in `generate.tsx`).
2. **Transcribe** — automatic speech-to-text with speaker labels.
3. **Find the moment** — AI scans the transcript and suggests 3–8 clip-worthy quotes/moments with timestamps
   (a punchy soundbite, a laugh, a strong opinion), or the user scrubs and picks their own.
4. **Generate the clip** — animated waveform (or a simple background/host photo), burned-in captions styled to
   the selected preset, episode branding (logo, name), sized for the target platform.
5. **Export everywhere** — vertical (TikTok/Reels/Shorts), square (Instagram feed), and a Spotify-Canvas-style
   loop, all in one pass — mirrors AIBeatSync's existing Release Kit multi-format export.

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
the pricing can be more generous than AIBeatSync's to drive adoption and virality:

- **Free** — 3 clips/month, 720p, "Made with AIPodSync" watermark (same growth mechanic as AIBeatSync's free
  watermarked tier).
- **Creator** — ~$12–15/mo, unlimited clips up to N episodes/month, no watermark, custom branding, 1080p.
- **Studio/Network** — for podcast networks and agencies managing multiple shows: team seats, multiple show
  profiles, priority processing, bulk/batch clip generation from a full back catalog. This is the highest-margin
  tier and the one most worth a direct sales motion.
- **Pay-as-you-go top-ups** — same credit-pack pattern as the recently-added $5/250-credit AIBeatSync pack,
  for occasional users who don't want a subscription.

## Backend reuse vs. net-new

**Reuse directly (minimal or no change):**
- Job queue/worker architecture (`jobProcessor.ts` pattern) — add a new job type, same polling/retry/heartbeat scaffolding.
- Upload + presigned-URL flow (`presignAndUpload`/object storage pattern from `editor.tsx`).
- Credits + Stripe billing scaffolding (`STATIC_PLANS`, checkout, webhook credit-granting) — new product line under the same billing architecture.
- ffmpeg pipeline and transition/crossfade logic from `editorStitcher.ts` — captions and waveform are just another filter-graph layer on the same rendering approach.
- Admin dashboard tab pattern (`admin.tsx`, `admin-jobs.ts`) — add a "AIPodSync jobs" tab or a fully separate but structurally identical admin.
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

## Brand & account strategy — decided: shared backend, separate front door, suite branding

Confirmed direction: same `api-server` monorepo, new route namespace (`/api/aipodsync/*`), same company and
(ideally) single sign-on so one account can reach both products. Same infrastructure leverage as before, now
explicitly framed as building a **suite**, not just two unrelated products that happen to share a backend:

- **aibeatsync.com** and **aipodsync.com** as siblings under one "AI ___ Sync" naming family — reads as an
  intentional product line, not a random second app, and leaves room for future additions in the same pattern.
- **Cross-promotion built into both navbars from day one** — an AIBeatSync user who also runs a podcast is
  exactly the ideal first AIPodSync customer, and vice versa (a podcaster who wants a beat-synced trailer or
  Spotify Canvas clip for their show). This is the actual growth engine for AIPodSync given the plan to target
  the smaller, less-contested niche rather than outspending OpusClip on paid acquisition.
- **Shared credits vs. separate wallets is still open** — simplest v1 is two separate credit balances under one
  login (avoids pricing-communication confusion, since audiogram costs should be much cheaper per-unit than
  video generation), with a possible future "suite bundle" plan that pools both once there's usage data to
  price it correctly.
- **A lightweight suite hub** (e.g. a shared account/billing page, or a simple "Products" switcher in each
  app's nav) ties the two together visually without merging the marketing sites themselves — each keeps its
  own homepage, pricing page, and positioning aimed at its own audience.

## Rough MVP scope (first cut, not full spec)

1. Upload/paste-link → transcript (Whisper via Pixazo) → basic waveform clip export, no AI highlight-picking yet (manual scrub only).
2. One caption style, one waveform style, vertical export only.
3. Credits reused from the existing billing scaffolding under a new low-cost product line.
4. AI highlight suggestions, multi-format export, and branding customization as fast-follow, not launch blockers.
