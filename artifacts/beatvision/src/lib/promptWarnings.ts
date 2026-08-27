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

/**
 * Returns a likely named person/character from a prompt. This intentionally
 * warns rather than blocks: prompts are free-form and a client-side heuristic
 * cannot identify every proper name without creating distracting false errors.
 */
export function detectNamedSubject(prompt: string): string | null {
  const trimmed = prompt.trim();
  if (!trimmed) return null;

  const knownName = COMMON_PERSON_OR_CHARACTER_NAMES.find((name) =>
    new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(trimmed),
  );
  if (knownName) return knownName;

  const contextualMatch = trimmed.match(NAME_AFTER_SUBJECT_PATTERN);
  return contextualMatch?.[1]?.trim() || null;
}