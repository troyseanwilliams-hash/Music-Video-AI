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