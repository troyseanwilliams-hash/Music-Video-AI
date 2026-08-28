export const MAX_CREATIVE_PROMPT_LENGTH = 12_000;

function shortenCompletePrompt(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;

  const sentences = normalized.match(/[^.!?]+[.!?]+(?=\s|$)/g) ?? [];
  const completeSentence = sentences.find((sentence) => sentence.trim().length <= maxLength)?.trim();
  if (completeSentence) return completeSentence;

  const words = normalized.split(" ");
  let shortened = "";
  for (const word of words) {
    const candidate = shortened ? `${shortened} ${word}` : word;
    if (candidate.length > Math.max(1, maxLength - 1)) break;
    shortened = candidate;
  }
  if (!shortened) return normalized.slice(0, maxLength).trimEnd();
  shortened = shortened.replace(/[,:;—-]+$/g, "").trim();
  return /[.!?]$/.test(shortened) ? shortened : `${shortened}.`.slice(0, maxLength);
}

export function compactGeneratedImagePromptScript(
  shots: Array<{ index: number; prompt: string }>,
): string {
  if (shots.length === 0) return "";
  const prefixes = shots.map((shot) => `${shot.index + 1}.`);
  const prefixLength = prefixes.reduce((total, prefix) => total + prefix.length, 0);
  const separatorLength = Math.max(0, shots.length - 1);
  const availablePromptLength = Math.max(
    shots.length * 40,
    MAX_CREATIVE_PROMPT_LENGTH - prefixLength - separatorLength,
  );
  const baseLineBudget = Math.floor(availablePromptLength / shots.length);
  const extraCharacters = availablePromptLength - baseLineBudget * shots.length;
  const lines = shots.map((shot, index) => {
    const lineBudget = baseLineBudget + (index < extraCharacters ? 1 : 0);
    const clipped = shortenCompletePrompt(shot.prompt, lineBudget);
    return `${prefixes[index]}${clipped}`;
  });
  return lines.join("\n");
}