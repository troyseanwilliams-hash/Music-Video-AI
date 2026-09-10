export interface SafeMediaPrompt {
  prompt: string;
  changed: boolean;
  reasons: string[];
}

export type PromptSafetyStatus = "clean" | "adjusted" | "blocked";

export interface PromptSafetyAssessment {
  status: PromptSafetyStatus;
  safePrompt: string;
  reason: string | null;
  reasons: string[];
}

const LEGACY_REFERENCE_DIRECTIVE_CLAUSES = [
  "use the same exact character shown in the attached reference image as the single canonical identity",
  "preserve its gender presentation identity face hair age wardrobe and distinguishing physical details",
  "do not invent substitute or redesign the character",
  "keep the same exact character shown in the attached reference image across all referenced scenes including the character's gender presentation",
];

function normalizeDirectiveWords(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function stripTruncatedLegacyReferenceDirective(input: string): {
  prompt: string;
  changed: boolean;
} {
  const styleMatch = /\.\s*Visual style:/i.exec(input);
  const boundary = styleMatch?.index ?? input.length;
  const scenePart = input.slice(0, boundary);
  const candidates = [...scenePart.matchAll(/[,;]\s*(?=(?:use|keep|preserve|do)\b)/gi)];

  for (let index = candidates.length - 1; index >= 0; index--) {
    const marker = candidates[index]!;
    const candidate = normalizeDirectiveWords(scenePart.slice(marker.index).replace(/^[,;]\s*/, ""));
    const isLegacyPrefix = candidate.length > 0 && LEGACY_REFERENCE_DIRECTIVE_CLAUSES.some((clause) => {
      const normalizedClause = normalizeDirectiveWords(clause);
      return normalizedClause === candidate || normalizedClause.startsWith(`${candidate} `);
    });
    if (isLegacyPrefix) {
      return {
        prompt: `${scenePart.slice(0, marker.index).trimEnd()}${input.slice(boundary)}`,
        changed: true,
      };
    }
  }
  return { prompt: input, changed: false };
}

const REWRITES: Array<{
  reason: string;
  pattern: RegExp;
  replacement: string;
}> = [
  {
    reason: "reference-identity-instruction",
    pattern: /\buse the same exact character shown in the attached reference image as the single canonical identity\b/gi,
    replacement: "match the principal character to the attached reference image",
  },
  {
    reason: "reference-identity-instruction",
    pattern: /;\s*preserve its gender presentation, identity, face, hair, age, wardrobe, and distinguishing physical details/gi,
    replacement: "",
  },
  {
    reason: "reference-identity-instruction",
    pattern: /;\s*do not invent(?:,\s*substitute)?(?:,\s*or\s+redesign(?:\s+the(?:\s+character)?)?)?/gi,
    replacement: "",
  },
  {
    reason: "reference-identity-instruction",
    pattern: /\bkeep the same exact character shown in the attached reference image across all referenced scenes, including the character['’]s gender presentation\b/gi,
    replacement: "match the principal character to the attached reference image",
  },
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
  {
    reason: "stylized-hazard",
    pattern: /\b(?:a\s+)?person\s+(?:is\s+)?(?:on fire|in flames)\b/gi,
    replacement: "a person surrounded by a harmless, stylized warm-light aura",
  },
  {
    reason: "stylized-hazard",
    pattern: /\b(?:flames?|fire)\s+(?:engulf|surround)(?:s|ing|ed)?\s+(?:a\s+|the\s+)?person\b/gi,
    replacement: "harmless, stylized warm light surrounds the person",
  },
  {
    reason: "stylized-hazard",
    pattern: /\b(?:denim\s+)?(?:jacket|coat|shirt|clothes?|clothing|hair|body)\s+(?:wreathes?|wreathed|wrapped|covered)\s+(?:in|with)\s+(?:harmless\s+|cartoon\s+|stylized\s+)*(?:flames?|fire)\b/gi,
    replacement: "clothing glows with harmless warm-light patterns",
  },
  {
    reason: "stylized-hazard",
    pattern: /\b(?:harmless\s+|cartoon\s+|stylized\s+)*(?:flames?|fire)\s+(?:around|across|on)\s+(?:his|her|their|the)\s+(?:jacket|coat|shirt|clothes?|clothing|hair|body)\b/gi,
    replacement: "harmless warm-light patterns across the clothing",
  },
  {
    reason: "startle-effect",
    pattern: /\b(?:an?\s+)?explosion\s+(?:in|near|beside)\s+(?:a\s+|the\s+|their\s+|his\s+|her\s+)?face\b/gi,
    replacement: "a harmless burst of colorful confetti nearby",
  },
  {
    reason: "startle-effect",
    pattern: /\b(?:pops?|popping|bursts?)\s+(?:in|near)\s+(?:a\s+|the\s+|their\s+|his\s+|her\s+)?face\b/gi,
    replacement: "creates a playful burst of colorful confetti nearby",
  },
  {
    reason: "startle-effect",
    pattern: /\b(?:pops?|popping|bursts?)\s+(?:in|near|beside|toward)\s+[^,.;]{0,45}\bface\b/gi,
    replacement: "transforms into a playful swirl of colorful confetti nearby",
  },
  {
    reason: "intense-expression",
    pattern: /\b(?:an?\s+)?obsessive(?:ly)?\s+star(?:e|es|ing|ed)\b/gi,
    replacement: "a calm, focused gaze",
  },
  {
    reason: "physical-distress",
    pattern: /\b(?:collapses?|collapsing|collapsed|faints?|fainting|fainted)\b/gi,
    replacement: "carefully sits down while companions offer support",
  },
  {
    reason: "damaged-surface",
    pattern: /\b(?:cracked|shattered|smashed)\s+(?:(?:phone|device|mirror|glass)\s+)?(?:glass|screens?|windows?)\b/gi,
    replacement: "an intact surface with an abstract mosaic-light pattern",
  },
  {
    reason: "ethereal-effect",
    pattern: /\bghost(?:ly|like)?\b/gi,
    replacement: "ethereal, dreamlike figure",
  },
  {
    reason: "ethereal-effect",
    pattern: /\b(?:dissolves?|dissolving|dissolved)\s+(?:into|away|in)\b/gi,
    replacement: "gently fades into",
  },
];

const BLOCKS: Array<{ reason: string; pattern: RegExp }> = [
  {
    reason: "Sexually explicit content is not supported.",
    pattern: /\b(?:porn(?:ography|ographic)?|rape|sexual assault|explicit sexual|sexually explicit|genitals?|penetration|orgasm|masturbat(?:e|ion)|sexual intercourse|nude|naked|topless|erotic)\b/i,
  },
  {
    reason: "Graphic injury or violence is not supported.",
    pattern: /\b(?:gore|gory|dismember(?:ed|ment)?|decapitat(?:e|ed|ion)|viscera|eviscerat(?:e|ed|ion)|severed (?:head|limb)|tortur(?:e|ed|ing)|blood spraying|graphic (?:blood|wound))\b/i,
  },
  {
    reason: "Self-harm content is not supported.",
    pattern: /\b(?:self[- ]harm|suicid(?:e|al)|hangs? (?:themself|himself|herself)|overdose|slits? (?:their|his|her) wrists?|cuts? (?:their|his|her) wrists?|kills? (?:themself|himself|herself))\b/i,
  },
  {
    reason: "Unsafe content involving a minor is not supported.",
    pattern: /\b(?:baby|infant|toddler|child|minor|teen(?:ager)?)\b[\s\S]{0,80}\b(?:nude|naked|sexual|erotic|abuse|assault|groom(?:ing|ed)?)\b|\b(?:nude|naked|sexual|erotic|abuse|assault|groom(?:ing|ed)?)\b[\s\S]{0,80}\b(?:baby|infant|toddler|child|minor|teen(?:ager)?)\b/i,
  },
];

export function sanitizeGeneratedMediaPrompt(input: string): SafeMediaPrompt {
  const original = input.replace(/\s+/g, " ").trim();
  const legacyCleanup = stripTruncatedLegacyReferenceDirective(original);
  let prompt = legacyCleanup.prompt
    .replace(/^(?:scene direction:\s*){2,}/i, "Scene direction: ")
    .replace(/\b(?:scene direction:\s*){2,}/gi, "scene direction: ");
  const reasons = new Set<string>();
  if (legacyCleanup.changed) reasons.add("reference-identity-instruction");

  for (const rewrite of REWRITES) {
    rewrite.pattern.lastIndex = 0;
    if (rewrite.pattern.test(prompt)) {
      reasons.add(rewrite.reason);
      rewrite.pattern.lastIndex = 0;
      prompt = prompt.replace(rewrite.pattern, rewrite.replacement);
    }
  }

  if (reasons.has("minor-contact")) {
    prompt = `Wholesome supervised family scene. ${prompt}`;
  }

  prompt = prompt
    .replace(/\s*;\s*([,.;:])/g, "$1")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .trim();
  return { prompt, changed: prompt !== original, reasons: [...reasons] };
}

/**
 * Pure final gate for the exact text sent to a media model. Rewrites common
 * benign false-positive wording first, then rejects any residual prohibited
 * content. Calling it repeatedly produces the same prompt and status.
 */
export function assessGeneratedMediaPrompt(input: string): PromptSafetyAssessment {
  const original = input.replace(/\s+/g, " ").trim();
  const originalBlock = BLOCKS.find(({ pattern }) => pattern.test(original));
  if (originalBlock) {
    return {
      status: "blocked",
      safePrompt: "",
      reason: originalBlock.reason,
      reasons: ["prohibited-content"],
    };
  }
  const sanitized = sanitizeGeneratedMediaPrompt(input);
  const blocked = BLOCKS.find(({ pattern }) => pattern.test(sanitized.prompt));
  if (blocked) {
    return {
      status: "blocked",
      safePrompt: "",
      reason: blocked.reason,
      reasons: ["prohibited-content"],
    };
  }
  if (sanitized.changed) {
    return {
      status: "adjusted",
      safePrompt: sanitized.prompt,
      reason: "Some wording was adjusted to keep the scene family-friendly.",
      reasons: sanitized.reasons,
    };
  }
  return {
    status: "clean",
    safePrompt: sanitized.prompt,
    reason: null,
    reasons: [],
  };
}