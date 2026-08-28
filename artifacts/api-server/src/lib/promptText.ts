/**
 * Keep generated visual prompts within their transport limit without exposing
 * an unfinished fragment to the user or image engine.
 */
export function shortenCompletePrompt(value: string, maxLength: number, fallback = ""): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return fallback;
  if (normalized.length <= maxLength) return normalized;

  // Prefer complete sentences whenever one fits. This keeps a long model
  // response from being cut in the middle of its visual instruction.
  const sentences = normalized.match(/[^.!?]+[.!?]+(?=\s|$)/g) ?? [];
  let completeSentences = "";
  for (const sentence of sentences) {
    const candidate = completeSentences
      ? `${completeSentences} ${sentence.trim()}`
      : sentence.trim();
    if (candidate.length > maxLength) break;
    completeSentences = candidate;
  }
  if (completeSentences) return completeSentences;

  // If even the first sentence is too long, stop at a whole word and close
  // the prompt as a sentence rather than adding an ellipsis to a fragment.
  const wordBudget = Math.max(1, maxLength - 1);
  const words = normalized.split(" ");
  let shortened = "";
  for (const word of words) {
    const candidate = shortened ? `${shortened} ${word}` : word;
    if (candidate.length > wordBudget) break;
    shortened = candidate;
  }

  if (!shortened) return normalized.slice(0, maxLength).trimEnd();
  shortened = shortened.replace(/[,:;—-]+$/g, "").trim();
  return /[.!?]$/.test(shortened)
    ? shortened
    : `${shortened}.`.slice(0, maxLength);
}