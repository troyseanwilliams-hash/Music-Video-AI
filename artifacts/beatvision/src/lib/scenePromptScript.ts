export const MAX_CREATIVE_PROMPT_LENGTH = 12_000;

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
    const normalized = shot.prompt.replace(/\s+/g, " ").trim();
    const clipped = normalized.length <= lineBudget
      ? normalized
      : `${normalized.slice(0, lineBudget - 1).trimEnd()}…`;
    return `${prefixes[index]}${clipped}`;
  });
  return lines.join("\n");
}