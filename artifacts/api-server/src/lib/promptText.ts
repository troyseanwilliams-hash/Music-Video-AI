/**
 * Keep generated visual prompts within their transport limit without exposing
 * an unfinished fragment to the user or image engine.
 */
export function shortenCompletePrompt(value: string, maxLength: number, fallback = ""): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return fallback;
  if (normalized.length <= maxLength) return normalized;

  // Preserve the prompt's ordered instructions, but stop at a whole word.
  const wordBudget = Math.max(1, maxLength - 1);
  const words = normalized.split(" ");
  let shortened = "";
  for (const word of words) {
    const candidate = shortened ? `${shortened} ${word}` : word;
    if (candidate.length > wordBudget) break;
    shortened = candidate;
  }

  if (!shortened) return normalized.slice(0, maxLength).trimEnd();
  shortened = shortened
    .replace(/\s+(?:a|an|the|and|or|of|to|from|with|without|in|on|at|by|for|as|through|under|over|into|across|beside)$/i, "")
    .replace(/[,:;—-]+$/g, "")
    .trim();
  return /[.!?]$/.test(shortened)
    ? shortened
    : `${shortened}.`.slice(0, maxLength);
}