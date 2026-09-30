// Marketing copy for the registration offer. Keep this aligned with auth,
// editorCost, creditCost, and music entitlements on the API.
export const FREE_OFFER = {
  trialDays: 7,
  startingGenerationCredits: 0,
  lifetimeInstrumentals: 3,
  lifetimeVocalSongs: 1,
  trialLyricExports: 3,
  trialAutoSyncs: 3,
  postTrialMonthlyMontageExports: 10,
  postTrialMontageOverageCredits: 15,
  referralSignupBonusCredits: 50,
} as const;

export const FREE_OFFER_COPY = {
  headline: "7-day free Montage trial — no card required",
  short: "Start a 7-day free Montage trial: unlimited clean exports with your own media, no card required.",
  music: "Includes 3 lifetime free instrumentals and 1 lifetime free vocal song.",
  trialExtras: "During the trial, get 3 lyric-burn exports and 3 Auto-sync aligns included.",
  afterTrial: "After the trial, non-paid accounts get 10 clean Montage exports per calendar month, then 15 credits per export.",
  credits: "New accounts start with 0 generation credits (except valid referral or promotional grants). AI images, video and narration require credits and are subject to existing plan rules.",
  paid: "Paid checkout charges immediately; the free Montage trial is not a free trial of paid AI plans.",
  referral: "If your invitation code is valid, you'll receive 50 bonus credits when you sign up.",
} as const;

export const freeOfferTerms = [
  FREE_OFFER_COPY.short,
  FREE_OFFER_COPY.music,
  FREE_OFFER_COPY.trialExtras,
  FREE_OFFER_COPY.afterTrial,
  FREE_OFFER_COPY.credits,
  FREE_OFFER_COPY.paid,
].join(" ");