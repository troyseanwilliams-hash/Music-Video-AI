export type PromptSuggestionMode = "image" | "narrative";
export type PromptSuggestionFormat = "summary" | "numbered";

export type PromptSuggestionExample = {
  id: string;
  title: string;
  summary: string;
  scenes: readonly string[];
};

export type NumberedSuggestionValidation = {
  valid: boolean;
  count: number;
  error?: string;
};

export function validatePromptSuggestionLength(
  script: string,
  maxLength = 12_000,
): string | undefined {
  return script.length > maxLength
    ? `Shorten this example to ${maxLength.toLocaleString()} characters or fewer.`
    : undefined;
}

/**
 * Short, original examples for the prompt helper. These are deliberately
 * local data: opening the helper never calls a planner or a media provider.
 */
export const PROMPT_SUGGESTIONS: Record<PromptSuggestionMode, readonly PromptSuggestionExample[]> = {
  image: [
    {
      id: "storm-lighthouse",
      title: "Storm lighthouse",
      summary:
        "A coastal cartographer follows a storm lantern to a lonely lighthouse, finds a stranded sailor, and guides them home as the clouds break over the sea.",
      scenes: [
        "A coastal cartographer in a yellow raincoat crosses windblown cliffs toward a distant lighthouse, storm clouds gathering over the sea.",
        "Inside the lighthouse, the cartographer discovers a stranded sailor beside a flickering lantern and offers a steady hand.",
        "The cartographer and sailor follow the lantern path down wet rocks toward a small rescue boat as the storm begins to ease.",
        "At sunrise, the rescued sailor reaches shore while the cartographer watches waves sparkle beneath the lighthouse beam.",
      ],
    },
    {
      id: "rooftop-garden",
      title: "Rooftop garden",
      summary:
        "A city gardener turns an abandoned rooftop into a living garden, shares its first harvest with neighbors, and watches the once-gray skyline glow with new color.",
      scenes: [
        "A city gardener carries a crate of seedlings onto an empty concrete rooftop between tall apartment buildings.",
        "The gardener builds raised beds and waters the first green shoots beneath a warm afternoon sky.",
        "Neighbors gather around the rooftop garden to share vegetables, flowers, and sunlight above the busy street.",
        "At golden hour, the thriving rooftop garden becomes a bright green island across the glowing city skyline.",
      ],
    },
  ],
  narrative: [
    {
      id: "signal-in-the-dunes",
      title: "Signal in the dunes",
      summary:
        "A determined astronomer leaves a desert observatory to follow a mysterious signal, crosses a night storm, and returns at sunrise with proof that she was not alone in the universe.",
      scenes: [
        "At sunset, a determined astronomer leaves her desert observatory after a mysterious signal flashes across the control room.",
        "She follows the signal through windblown dunes as a night storm gathers and red lights pulse beyond the ridge.",
        "At an abandoned research station, she finds a quiet beacon glowing beneath the stars and records its impossible pattern.",
        "At sunrise, she returns to the observatory with the recording while the first light reveals the beacon still shining far away.",
      ],
    },
    {
      id: "last-garden-train",
      title: "The last garden train",
      summary:
        "A quiet conductor carries the final seed collection through a drought-stricken valley, finds a hidden spring, and brings the valley its first green season in years.",
      scenes: [
        "A quiet conductor loads the last collection of seeds onto a small train waiting beside a dry valley at dawn.",
        "The train winds through dusty hills while the conductor studies an old map for a forgotten source of water.",
        "Following the map, the conductor discovers a hidden spring beneath an abandoned station and fills the train's tanks.",
        "Rain arrives over the valley as the conductor shares the seeds with the villagers and new green shoots appear.",
      ],
    },
  ],
};

function safeImageCount(imageCount: number): number {
  if (!Number.isFinite(imageCount)) return 1;
  return Math.max(1, Math.round(imageCount));
}

/**
 * Turns a short summary into an image-pack brief that explicitly asks the
 * planner to expand it to the selected number of stills. When there are more
 * requested images than authored beats, the planner can add natural
 * in-between moments without the helper inventing filler scenes.
 */
export function formatImageSummary(example: PromptSuggestionExample, imageCount: number): string {
  const count = safeImageCount(imageCount);
  const beatText = example.scenes.slice(0, count).join(" ");
  const expansion =
    count <= example.scenes.length
      ? `Expand this into exactly ${count} chronological images and preserve these key beats in order: ${beatText}`
      : `Expand this into exactly ${count} chronological images, adding natural in-between moments while preserving the story's continuity. Keep these key beats in order: ${beatText}`;
  return `${example.summary} ${expansion}`;
}

export function formatNumberedScenes(example: PromptSuggestionExample): string {
  return example.scenes.map((scene, index) => `${index + 1}. ${scene}`).join("\n");
}

export function formatPromptSuggestion(
  example: PromptSuggestionExample,
  mode: PromptSuggestionMode,
  format: PromptSuggestionFormat,
  imageCount = example.scenes.length,
): string {
  if (format === "numbered") return formatNumberedScenes(example);
  if (mode === "image") return formatImageSummary(example, imageCount);
  return `${example.summary} Let the engine turn this into a chronological visual story paced to the selected video length.`;
}

/**
 * Validate the editable image-pack preview before it can be copied into the
 * real prompt. Keeping this separate from the page's planner validation means
 * an invalid suggestion can never change the draft or image count.
 */
export function validateNumberedSuggestion(
  script: string,
  maxScenes = 30,
): NumberedSuggestionValidation {
  const lines = script.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) {
    return { valid: false, count: 0, error: "Add at least one numbered scene." };
  }

  let expected = 1;
  for (const line of lines) {
    const match = line.match(/^(?:scene\s+)?(\d{1,2})\s*(?:[.):]|[-–—])\s*(\S.*)$/i);
    if (!match || !match[2]?.trim()) {
      return {
        valid: false,
        count: expected - 1,
        error: "Use one complete scene per line, numbered consecutively from 1.",
      };
    }
    const number = Number(match[1]);
    if (number !== expected) {
      return {
        valid: false,
        count: expected - 1,
        error: `Number scenes consecutively from 1 (scene ${expected} is next).`,
      };
    }
    if (number > maxScenes) {
      return {
        valid: false,
        count: expected - 1,
        error: `Image packs support at most ${maxScenes} numbered scenes.`,
      };
    }
    expected += 1;
  }

  return { valid: true, count: expected - 1 };
}

export function countNumberedSuggestionScenes(script: string): number {
  return validateNumberedSuggestion(script).count;
}