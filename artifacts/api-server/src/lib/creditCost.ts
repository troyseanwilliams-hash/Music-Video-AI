const MAX_CLIPS_PER_JOB = 3;
const RUNWAY_USD_PER_SEC = 0.05;
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
  const totalSec = numClips * clipDurationSec;
  const chargeUSD = totalSec * RUNWAY_USD_PER_SEC * MARKUP;
  return Math.ceil(chargeUSD / USD_PER_CREDIT);
}
