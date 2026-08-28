const COMMON_PERSON_OR_CHARACTER_NAMES = [
  "Amelia Earhart",
  "Albert Einstein",
  "Barack Obama",
  "Beyoncé",
  "Bob Marley",
  "David Bowie",
  "Elvis Presley",
  "Frida Kahlo",
  "James Dean",
  "Marilyn Monroe",
  "Michael Jackson",
  "Nelson Mandela",
  "Taylor Swift",
  "Vincent van Gogh",
  "Audrey Hepburn",
  "Batman",
  "Barbie",
  "Darth Vader",
  "Harry Potter",
  "James Bond",
  "Mickey Mouse",
  "Sherlock Holmes",
  "Spider-Man",
  "Superman",
  "Wonder Woman",
];

const NAME_AFTER_SUBJECT_PATTERN =
  /\b(?:portrait|photo(?:graph)?|image|depict(?:ing)?|show(?:ing)?|featur(?:ing)|of|as|playing|portray(?:ing)?|inspired by|character named|named)\s+(?:a|an|the|our|this|one)?\s*([A-Z][A-Za-z'-]*(?:\s+[A-Z][A-Za-z'-]*){0,2})\b/;

const KNOWN_SUBJECT_DESCRIPTIONS: Record<string, string> = {
  "amelia earhart": "a pioneering early-20th-century woman aviator with short auburn hair, a confident gaze, and period-accurate leather flight gear",
  "albert einstein": "an elderly theoretical physicist with wild white hair, a full moustache, and a dark period suit",
  "frida kahlo": "a Mexican painter with dark braided hair adorned with flowers, strong brows, and a colorful traditional blouse",
  "bob marley": "a Jamaican reggae musician with long dreadlocks, warm expressive eyes, and relaxed 1970s attire",
  "david bowie": "a distinctive British rock performer with angular features, styled hair, and bold era-specific stage clothing",
  "elvis presley": "a charismatic mid-century rock-and-roll singer with swept-back dark hair and a sharp vintage stage suit",
  "marilyn monroe": "a classic mid-century film actress with platinum curls, softly arched brows, and an elegant vintage dress",
  "nelson mandela": "an elder South African statesman with close-cropped white hair, kind eyes, and a dignified formal suit",
  "vincent van gogh": "a nineteenth-century Dutch painter with reddish hair, a short beard, and a worn blue work jacket",
};

function escapedPattern(value: string): RegExp {
  return new RegExp(`\\b${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
}

export function detectNamedSubject(prompt: string): string | null {
  const trimmed = prompt.trim();
  if (!trimmed) return null;
  const knownName = COMMON_PERSON_OR_CHARACTER_NAMES.find((name) =>
    escapedPattern(name).test(trimmed)
  );
  if (knownName) return knownName;
  return trimmed.match(NAME_AFTER_SUBJECT_PATTERN)?.[1]?.trim() || null;
}

export function containsNamedSubject(value: string, namedSubject: string | null): boolean {
  return !!namedSubject && escapedPattern(namedSubject).test(value);
}

export function replaceNamedSubjectWithReference(
  value: string,
  namedSubject: string | null,
): string {
  if (!namedSubject) return value;
  return value
    .replace(escapedPattern(namedSubject), "the referenced character")
    .replace(/\s+/g, " ")
    .trim();
}

export function fallbackNamedSubjectDescription(namedSubject: string): string {
  return KNOWN_SUBJECT_DESCRIPTIONS[namedSubject.trim().toLocaleLowerCase()]
    ?? "a historically grounded figure with distinctive period-appropriate features, clothing, and demeanor based on the surrounding scene";
}

export function replaceNamedSubjectWithDescription(
  value: string,
  namedSubject: string | null,
): string {
  if (!namedSubject) return value;
  return value
    .replace(escapedPattern(namedSubject), fallbackNamedSubjectDescription(namedSubject))
    .replace(/\s+/g, " ")
    .trim();
}