// Marketing copy for the registration offer. Keep this aligned with auth,
// editorCost, creditCost, and music entitlements on the API.
export const FREE_OFFER = {
  trialDays: 7,
  startingGenerationCredits: 150,
  trialLyricExports: 0,
  trialAutoSyncs: 0,
  postTrialMonthlyMontageExports: 10,
  postTrialMontageOverageCredits: 15,
} as const;

export const FREE_OFFER_COPY = {
  headline: "Get 150 free credits when you create your account.",
  short: "Get 150 free credits when you create your account.",
  example: "Enough for about 21 images, or 1 video clip plus several images. Actual usage varies by model and settings.",
  expiry: "Unused welcome credits expire when your 7-day trial ends.",
  videoExample: "For the clip-plus-images example, choose a 5-second 720p Kling clip; higher-cost settings may leave fewer credits for images.",
  music: "New accounts use credits for music. Paid subscribers also retain monthly included instrumentals (Starter 25, Pro 100, Studio 300); vocal songs use credits.",
  trialExtras: "Clean Montage Studio exports are included during the active trial. Karaoke lyric-burn exports and Auto-sync aligns use credits; paid subscriber features retain their plan benefits.",
  afterTrial: "After the trial, non-paid accounts get 10 clean Montage exports per calendar month, then 15 credits per export.",
  credits: "Music beyond paid subscriber included instrumentals, AI images, video and narration use credits and are subject to plan rules. Montage Studio access continues within the applicable trial and post-trial limits even when credits run out.",
  paid: "No card is required to create an account. Paid checkout charges immediately; account credits are not a free trial of paid AI plans.",
  referral: "Your invitation code will be applied when you sign up.",
} as const;

export const freeOfferTerms = [
  FREE_OFFER_COPY.short,
  FREE_OFFER_COPY.example,
  FREE_OFFER_COPY.expiry,
  FREE_OFFER_COPY.videoExample,
  FREE_OFFER_COPY.music,
  FREE_OFFER_COPY.trialExtras,
  FREE_OFFER_COPY.afterTrial,
  FREE_OFFER_COPY.credits,
  FREE_OFFER_COPY.paid,
].join(" ");