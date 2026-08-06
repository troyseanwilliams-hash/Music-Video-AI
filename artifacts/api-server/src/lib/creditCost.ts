// Credit cost for an AI generation. Priced above the *real* provider cost so
// every duration is profitable. Cost tracks how many provider clips a job
// actually generates (see getClipPlan) × the provider per-second rate. Runway
// The Freeway rate ($1.40 per 10s clip = $0.14/s) is the (most expensive)
// basis, so cheaper providers only widen the margin. Markup is tiered:
// single-clip (short) videos at 2× (100% margin), multi-clip (longer) videos
// at 1.5× (50% margin) to stay competitive.
//
// Scale (Freeway basis, ~$0.015/credit):
//   5s   → ~94 credits   (1 clip × 5s  = $0.70 → ×2   = $1.40)
//   10s  → ~187 credits  (1 clip × 10s = $1.40 → ×2   = $2.80)
//   30s  → 420 credits   (3 clips×10s  = $4.20 → ×1.5 = $6.30)
//   60s  → 840 credits   (6 clips×10s  = $8.40 → ×1.5 = $12.60)
//   300s → 2100 credits  (explicit "5 min": 15 clips, 720p basis)
//   600s → 4200 credits  (explicit "10 min": 30 clips — 2× the 5-min)
//   full → 420–2800      (3–20 clips scaled by song length, capped at 10 min)
// Resolution scales the charge on top: 720p ×1, 1080p ×1.25, 4K ×5.0 (4K is a
// premium tier — genuinely ~3× the provider compute).

// Real provider cost basis: Freeway = $1.40 per 10-second clip = $0.14/s.
const RUNWAY_USD_PER_SECOND = 0.14; // Freeway: $1.40 per 10s clip
// Standard Kling via the Pixazo gateway = ~$0.07/s (the cheaper "value" engine).
const KLING_USD_PER_SECOND = 0.07;
function usdPerSecondFor(provider?: string | null): number {
  return (provider ?? "").toLowerCase() === "kling" ? KLING_USD_PER_SECOND : RUNWAY_USD_PER_SECOND;
}
// Dollar value of one credit, set below the cheapest plan's rate (Studio:
// $79 / 5,000 = $0.0158/credit) so the margin holds on every plan.
const USD_PER_CREDIT = 0.015;
// Tiered markup: short (single-clip) videos 2×. Longer (multi-clip) videos vary
// by engine — Runway 1.5×, Kling 1.75× (Kling's lower provider cost leaves room
// for a fatter margin while staying competitive).
const SHORT_MARKUP = 2;
const LONG_MARKUP = 1.5;
const KLING_LONG_MARKUP = 1.75;

// Profit margin: the user-facing price is always double the underlying cost
// scale (BASE + seconds), so charge − cost = cost — i.e. the second half of
// every charge is the site's profit (100% markup / 50% margin). Mirror any
// change here in artifacts/beatvision/src/lib/creditPricing.ts (and the local
// estimators in dashboard.tsx, job-status.tsx, editor.tsx) + editorCost.ts.
export const PRICE_MULTIPLIER = 2;

// Full videos are capped at 10 minutes and scale unique clips with (capped) song
// length: ~1 clip per 30s, min 3, max 20.
export const MAX_FULL_SECONDS = 600;
export function fullClipCount(songDurationSec?: number | null): number {
  const secs = songDurationSec && songDurationSec > 0 ? songDurationSec : MAX_FULL_SECONDS;
  return Math.max(3, Math.min(20, Math.ceil(Math.min(secs, MAX_FULL_SECONDS) / 30)));
}

export function getClipPlan(
  requestedDuration: string | null | undefined,
  songDurationSec?: number | null,
): { numClips: number; clipDurationSec: 5 | 10 } {
  const dur = requestedDuration ?? "full";
  if (dur === "full") {
    return { numClips: fullClipCount(songDurationSec), clipDurationSec: 10 };
  }
  const durSec = parseInt(dur, 10);
  const clipDurationSec: 5 | 10 = durSec <= 5 ? 5 : 10;
  // Explicit durations over 2 min scale by length so 10 min ≈ 2× 5 min: ~1 clip
  // per 20s, capped at 30 (5 min = 15 clips, 10 min = 30). Clips are looped to
  // fill the runtime. Shorter durations keep 1 clip per 10s.
  const numClips = durSec > 120
    ? Math.min(30, Math.ceil(durSec / 20))
    : Math.max(1, Math.ceil(durSec / clipDurationSec));
  return { numClips, clipDurationSec };
}

// Real (pre-markup) provider cost of a generation, in credits.
// profit = calculateCreditCost − this.
function providerCostCredits(
  requestedDuration: string | null | undefined,
  songDurationSec?: number | null,
  provider?: string | null,
): number {
  const { numClips, clipDurationSec } = getClipPlan(requestedDuration, songDurationSec);
  const usd = numClips * clipDurationSec * usdPerSecondFor(provider);
  return usd / USD_PER_CREDIT;
}

// 2× markup for single-clip (short) videos; for multi-clip (longer) videos the
// markup depends on engine: Kling 1.75×, everything else (Runway) 1.5×.
function markupFor(
  requestedDuration: string | null | undefined,
  songDurationSec?: number | null,
  provider?: string | null,
): number {
  if (getClipPlan(requestedDuration, songDurationSec).numClips <= 1) return SHORT_MARKUP;
  return (provider ?? "").toLowerCase() === "kling" ? KLING_LONG_MARKUP : LONG_MARKUP;
}

// Resolution surcharge. 720p is the base rate; higher resolutions cost
// materially more provider compute (Kling: 720p ≈ 0.8, 1080p ≈ 1.0, 4K ≈ 3.0
// units/s), so the charge scales to protect margin. 4K is a premium tier.
export function resolutionMultiplier(resolution?: string | null): number {
  const r = (resolution ?? "").toLowerCase();
  if (r === "4k" || r === "2160p") return 5.0;
  if (r === "1080p") return 1.25;
  return 1; // 720p / default
}

export function calculateBaseCost(
  requestedDuration: string | null | undefined,
  resolution?: string | null,
  songDurationSec?: number | null,
): number {
  return Math.ceil(providerCostCredits(requestedDuration, songDurationSec) * resolutionMultiplier(resolution));
}

// Estimated == actual cost (the same function backs the pre-flight estimate
// shown to the customer and the deduction from their balance on success).
// charge = ceil(real provider cost in credits × tiered markup × resolution
// multiplier). songDurationSec sizes "full" videos (clips scale with length,
// capped at 10 min).
export function calculateCreditCost(
  requestedDuration: string | null | undefined,
  resolution?: string | null,
  songDurationSec?: number | null,
  provider?: string | null,
): number {
  return Math.ceil(
    providerCostCredits(requestedDuration, songDurationSec, provider) *
      markupFor(requestedDuration, songDurationSec, provider) *
      resolutionMultiplier(resolution),
  );
}

// Free monthly "Soundtracks" (instrumental) allowance by subscription tier —
// a bonus that upsells higher plans. Beyond it, tracks cost credits.
// Provider cost is fixed at ~$0.0217/track, so a generous allowance stays cheap:
// Starter 25 ≈ $0.54/mo, Pro 100 ≈ $2.17/mo, Studio 300 ≈ $6.51/mo — small
// fractions of each plan. Competitive with the music-gen market as a bonus.
export const FREE_SOUNDTRACKS_BY_TIER: Record<string, number> = {
  starter: 25,
  pro: 100,
  studio: 300,
};
// One-time signup bonus: brand-new (non-subscriber) users get this many free
// Soundtracks to try the feature before subscribing. Lifetime, not monthly.
export const NEW_USER_FREE_SOUNDTRACKS = 3;
export function freeSoundtracksFor(tier?: string | null): number {
  if (!tier) return 0;
  const t = tier.toLowerCase();
  for (const [prefix, n] of Object.entries(FREE_SOUNDTRACKS_BY_TIER)) {
    if (t.startsWith(prefix)) return n;
  }
  return 0;
}

// Cost to generate a Soundtrack. The provider cost is FIXED per file (Stable
// Audio 3 Small ≈ $0.0217, any length), so the charge is a small band: it
// scales a little by length but is capped at 10 credits for a full 2-min track
// to keep it cheap and predictable. Range: 5 credits (short) → 10 credits (2 min).
const SONG_USD_PER_SECOND = 0.002;
const SONG_MIN_CREDITS = 5;
const SONG_MAX_CREDITS = 10;
const SONG_MIN_SECONDS = 5;
const SONG_MAX_SECONDS = 120;
// Music generation is priced at a 1.5× markup on the real provider cost.
const MUSIC_GEN_MARKUP = 1.5;
// Full VOCAL songs run on MiniMax Music, a flat ~$0.15/generation model (≈7×
// the instrumental Stable Audio cost). Charged as a flat credit price (never
// part of the free monthly allowance). Derived: ceil($0.15 × 1.5 / $/credit) = 15.
const VOCAL_SONG_USD = 0.15;
export const SONG_VOCAL_CREDITS = Math.ceil((VOCAL_SONG_USD * MUSIC_GEN_MARKUP) / USD_PER_CREDIT);
export function calculateSongCost(
  durationSeconds: number | null | undefined,
  withVocals = false,
): number {
  if (withVocals) return SONG_VOCAL_CREDITS;
  const secs = Math.min(Math.max(durationSeconds || 30, SONG_MIN_SECONDS), SONG_MAX_SECONDS);
  const scaled = Math.ceil((secs * SONG_USD_PER_SECOND * MUSIC_GEN_MARKUP) / USD_PER_CREDIT);
  return Math.min(SONG_MAX_CREDITS, Math.max(SONG_MIN_CREDITS, scaled));
}

// Cost to remix (regenerate) a subset of an existing video's clips. Charged
// proportionally to the number of clips regenerated — never the full job. We
// divide the original job's full cost across its clips and bill only for the
// ones being redone (minimum 1 credit when at least one clip is selected).
export function calculateRemixCost(
  requestedDuration: string | null | undefined,
  totalClips: number,
  regeneratedClips: number,
  resolution?: string | null,
): number {
  const safeTotal = Math.max(1, totalClips);
  const safeRegen = Math.max(0, Math.min(regeneratedClips, safeTotal));
  if (safeRegen === 0) return 0;
  const perClip = calculateCreditCost(requestedDuration, resolution) / safeTotal;
  return Math.max(1, Math.ceil(perClip * safeRegen));
}

// Flat cost for a teaser pack (3 vertical TikTok/Shorts cuts of an existing
// video). Pure ffmpeg — no AI generation — so it's priced like a small render.
// Mirror in artifacts/beatvision/src/lib/creditPricing.ts.
export const TEASER_PACK_COST = 15 * PRICE_MULTIPLIER;

// Flat cost for a Spotify Canvas export (one 9:16 loop, 3–8s, cut from an
// existing video). Mirror in artifacts/beatvision/src/lib/creditPricing.ts.
export const CANVAS_EXPORT_COST = 10 * PRICE_MULTIPLIER;

// Flat cost to burn karaoke lyrics onto an existing finished video (pure
// ffmpeg re-encode). Mirror in artifacts/beatvision/src/lib/creditPricing.ts.
export const LYRIC_OVERLAY_COST = 10 * PRICE_MULTIPLIER;

// Bundled "Release Kit": teaser pack + Canvas loop generated together, ~20% off
// vs buying them separately (the full video + thumbnail are already free). Lyrics
// burn, when included, is charged separately at LYRIC_OVERLAY_COST.
export const RELEASE_KIT_COST = TEASER_PACK_COST + CANVAS_EXPORT_COST - 10;

// Cost to generate a full set of lyrics in Prompt Studio. Real LLM cost is tiny
// (Claude Sonnet 5 ≈ $0.006–0.009 ≈ ~0.6 credits), so 2 credits covers it with a
// healthy margin. Not charged when the no-key template fallback is used.
export const LYRICS_BUILD_COST = 2;
