// "Something of the Day" — a small rotating engagement widget on the homepage.
//
// Rotation is deterministic, not cron-driven: the item shown is derived from a
// hash of today's UTC date (YYYY-MM-DD) modulo the list length. This means:
//   - every visitor sees the same item on a given day (like a daily puzzle)
//   - it flips over automatically at UTC midnight with zero server state
//   - there's no scheduled job to miss, retry, or go stale after a deploy
//   - it works identically across any number of server instances
// If we ever want admin-editable content, swap DAILY_CONTENT for a DB table
// and keep getDailyContent()'s hashing logic — the interface won't change.

export type DailyItemType = "pun" | "proverb" | "fact" | "tip";

export interface DailyItem {
  type: DailyItemType;
  text: string;
}

export const DAILY_ITEM_LABELS: Record<DailyItemType, string> = {
  pun: "Pun of the Day",
  proverb: "Proverb of the Day",
  fact: "Fun Fact",
  tip: "Pro Tip",
};

export const DAILY_CONTENT: DailyItem[] = [
  // ---- Puns ----
  { type: "pun", text: "I was going to tell a joke about a music video, but it never really cut together." },
  { type: "pun", text: "Why did the beat go to therapy? It had too many drops." },
  { type: "pun", text: "My favorite key change? The one from “thinking about it” to “just exporting it.”" },
  { type: "pun", text: "Editing videos is easy — it's all just a montage of good decisions." },
  { type: "pun", text: "I asked my AI for a plot twist. It gave me a jump cut instead." },
  { type: "pun", text: "What do you call a video with perfect timing? Beat-ifically synced." },
  { type: "pun", text: "I tried to make a silent film. It just fell flat — not really my genre." },
  { type: "pun", text: "Why don't musicians ever get lost? They always follow the score." },
  { type: "pun", text: "My timeline is a mess, but at least it's on-brand." },
  { type: "pun", text: "The transition was so smooth, even the credits rolled with it." },
  { type: "pun", text: "I'm reading a book on anti-gravity montages. It's impossible to put down." },
  { type: "pun", text: "Our AI never gets stage fright — it just renders with confidence." },
  { type: "pun", text: "What's a DJ's favorite kind of proof? Beat-matched evidence." },
  { type: "pun", text: "I told my export “take your time.” It really took me literally." },
  { type: "pun", text: "Why did the video clip apply for a loan? It wanted better credit(s)." },

  // ---- Chinese proverbs ----
  { type: "proverb", text: "A journey of a thousand miles begins with a single step." },
  { type: "proverb", text: "The best time to plant a tree was 20 years ago. The second best time is now." },
  { type: "proverb", text: "Give a man a fish and you feed him for a day; teach a man to fish and you feed him for a lifetime." },
  { type: "proverb", text: "Patience is bitter, but its fruit is sweet." },
  { type: "proverb", text: "A single conversation with a wise person is better than ten years of study." },
  { type: "proverb", text: "He who asks a question is a fool for five minutes; he who does not ask remains a fool forever." },
  { type: "proverb", text: "Better to light a candle than to curse the darkness." },
  { type: "proverb", text: "A closed mind is like a closed book — just a block of wood." },
  { type: "proverb", text: "Failure is the mother of success." },
  { type: "proverb", text: "The gem cannot be polished without friction, nor a person perfected without trials." },
  { type: "proverb", text: "Tell me and I forget, teach me and I may remember, involve me and I learn." },
  { type: "proverb", text: "One generation plants the trees; another gets the shade." },
  { type: "proverb", text: "If you want happiness for a lifetime, help the next generation." },
  { type: "proverb", text: "A bird does not sing because it has an answer — it sings because it has a song." },
  { type: "proverb", text: "When the winds of change blow, some people build walls and others build windmills." },

  // ---- Fun facts ----
  { type: "fact", text: "MTV played its very first music video, “Video Killed the Radio Star,” on August 1, 1981." },
  { type: "fact", text: "The human ear can distinguish roughly 1,400 different pitches across its full hearing range." },
  { type: "fact", text: "The longest officially released song on record runs over 13 hours." },
  { type: "fact", text: "Octopuses have three hearts and blue blood." },
  { type: "fact", text: "A bolt of lightning is roughly five times hotter than the surface of the sun." },
  { type: "fact", text: "Honey never spoils — archaeologists have found 3,000-year-old honey that's still edible." },
  { type: "fact", text: "The first 1GB hard drive, released in 1980, weighed about 550 pounds." },
  { type: "fact", text: "Bananas are botanically classified as berries — strawberries, oddly, are not." },
  { type: "fact", text: "The average person blinks 15–20 times per minute." },
  { type: "fact", text: "Sound travels roughly 4.3 times faster through water than through air." },
  { type: "fact", text: "The word “robot” comes from the Czech word “robota,” meaning forced labor." },
  { type: "fact", text: "The first computer “bug” was an actual moth found in a Harvard Mark II relay in 1947." },
  { type: "fact", text: "The shortest war in recorded history lasted just 38 minutes — Britain vs. Zanzibar, 1896." },
  { type: "fact", text: "A hummingbird's heart can beat over 1,200 times per minute during flight." },
  { type: "fact", text: "The first YouTube video ever uploaded was called “Me at the zoo,” posted in April 2005." },

  // ---- Product tips (AIBeatSync features) ----
  { type: "tip", text: "You can pin the AI Generator to any 5 or 10-second window of your track — not just the beginning — to capture your favorite drop or hook." },
  { type: "tip", text: "In Montage Studio you can drop your own photos in alongside video clips and sync everything to the beat — no watermark on export." },
  { type: "tip", text: "Every new account gets a free 7-day trial with unlimited Montage Studio exports — no credit card required." },
  { type: "tip", text: "You can paste a Suno share link straight into the generator — no need to download and re-upload your track." },
  { type: "tip", text: "Prompt can generate lyrics for 3 credits — handy for finishing a song idea fast." },
  { type: "tip", text: "Montage Studio supports smooth transitions between every clip on your timeline — crossfade, Circle Open, and more." },
  { type: "tip", text: "You can generate 5-second Spotify Canvas clips, perfectly sized and beat-synced, ready to upload straight to Spotify for Artists." },
  { type: "tip", text: "Refer a friend and you'll both earn free credits — grab your referral link from your dashboard." },
  { type: "tip", text: "Upload a reference image — album art, a mood board, anything — and the AI keeps your video's look on-brand from the first frame." },
  { type: "tip", text: "Choose from 8 distinct cinematic visual styles when generating with AI, from documentary grit to ethereal fantasy." },
  { type: "tip", text: "Montage Studio exports are always 1080p and watermark-free, even on a free account." },
  { type: "tip", text: "Music has 14 genre presets — from Lofi chill to Afrobeats — to jumpstart your next instrumental." },
  { type: "tip", text: "You can preview your Montage Studio timeline live before exporting, so there are no surprises in the final render." },
  { type: "tip", text: "Low on credits? The $5 starter pack gets you 250 credits — the cheapest way to try the AI Generator." },
  { type: "tip", text: "Montage Studio uploads have automatic retry protection, so a dropped connection won't leave you stuck on a spinner." },
];

function hashDateToIndex(dateStr: string, mod: number): number {
  let hash = 0;
  for (let i = 0; i < dateStr.length; i++) {
    hash = (Math.imul(hash, 31) + dateStr.charCodeAt(i)) >>> 0;
  }
  return hash % mod;
}

/** Returns today's item, deterministic per UTC calendar day. */
export function getDailyContent(date: Date = new Date()): DailyItem & { label: string } {
  const dateStr = date.toISOString().slice(0, 10); // YYYY-MM-DD, UTC
  const idx = hashDateToIndex(dateStr, DAILY_CONTENT.length);
  const item = DAILY_CONTENT[idx];
  return { ...item, label: DAILY_ITEM_LABELS[item.type] };
}
