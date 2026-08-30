export type SongSettlement = "free-vocal" | "free-instrumental" | "paid";

export function getSongSettlement(
  isFree: boolean,
  wantsVocals: boolean,
): SongSettlement {
  if (!isFree) return "paid";
  return wantsVocals ? "free-vocal" : "free-instrumental";
}