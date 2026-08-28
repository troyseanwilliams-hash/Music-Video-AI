export interface SafeMediaPrompt {
  prompt: string;
  changed: boolean;
  reasons: string[];
}

const REWRITES: Array<{
  reason: string;
  pattern: RegExp;
  replacement: string;
}> = [
  {
    reason: "minor-contact",
    pattern: /\b(?:nuzzles?|kisses?|caresses?|touches?|cuddles?)\s+(?:the\s+)?(?:baby|infant|toddler|young child|child)(?:['’]s)?(?:\s+(?:hand|face|body))?/gi,
    replacement: "stays at a respectful distance while a parent remains beside the child",
  },
  {
    reason: "minor-contact",
    pattern: /\b(?:to\s+)?play(?:s|ing)?\s+with\s+(?:a\s+|the\s+)?(?:curious\s+)?(?:baby|infant|toddler|young child|child)\b/gi,
    replacement: "to perform a playful routine nearby while a parent holds the child",
  },
  {
    reason: "adult-content",
    pattern: /\b(?:nude|naked|topless|explicit sexual|sexually explicit|erotic)\b/gi,
    replacement: "fully clothed, family-friendly, and non-romantic",
  },
  {
    reason: "graphic-violence",
    pattern: /\b(?:gore|gory|dismember(?:ed|ment)?|decapitat(?:e|ed|ion)|graphic blood(?:shed)?)\b/gi,
    replacement: "non-graphic dramatic tension",
  },
  {
    reason: "self-harm",
    pattern: /\b(?:self[- ]harm|suicide|suicidal|cuts? (?:their|his|her) wrists?)\b/gi,
    replacement: "a person receiving compassionate support in a hopeful, safe setting",
  },
];

export function sanitizeGeneratedMediaPrompt(input: string): SafeMediaPrompt {
  const original = input.replace(/\s+/g, " ").trim();
  let prompt = original
    .replace(/^(?:scene direction:\s*){2,}/i, "Scene direction: ")
    .replace(/\b(?:scene direction:\s*){2,}/gi, "scene direction: ");
  const reasons = new Set<string>();

  for (const rewrite of REWRITES) {
    if (rewrite.pattern.test(prompt)) {
      reasons.add(rewrite.reason);
      rewrite.pattern.lastIndex = 0;
      prompt = prompt.replace(rewrite.pattern, rewrite.replacement);
    }
  }

  if (reasons.has("minor-contact")) {
    prompt = `Wholesome supervised family scene. ${prompt}`;
  }

  prompt = prompt.replace(/\s+/g, " ").replace(/\s+([,.;:])/g, "$1").trim();
  return { prompt, changed: prompt !== original, reasons: [...reasons] };
}