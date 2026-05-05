const MAX_CLIPS_PER_JOB = 3;

const RUNWAY_TOKENS_PER_5S = 330;
const RUNWAY_TOKENS_PER_10S = 660;
const RUNWAY_USD_PER_TOKEN = 0.01;
const MARKUP = 2;
const USD_PER_CREDIT = 0.10;

export function calculateCreditCost(requestedDuration: string | null | undefined): number {
  const dur = requestedDuration ?? "full";
  let clipDurationSec: 5 | 10;
  let numClips: number;
  if (dur === "full") {
    clipDurationSec = 10;
    numClips = MAX_CLIPS_PER_JOB;
  } else {
    const durSec = parseInt(dur, 10);
    clipDurationSec = durSec <= 5 ? 5 : 10;
    numClips = Math.max(1, Math.ceil(durSec / clipDurationSec));
  }
  const tokensPerClip = clipDurationSec === 5 ? RUNWAY_TOKENS_PER_5S : RUNWAY_TOKENS_PER_10S;
  const totalTokens = numClips * tokensPerClip;
  const chargeUSD = totalTokens * RUNWAY_USD_PER_TOKEN * MARKUP;
  return Math.ceil(chargeUSD / USD_PER_CREDIT);
}
