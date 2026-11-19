import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { ListOrdered, Sparkles, TextQuote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  formatPromptSuggestion,
  PROMPT_SUGGESTIONS,
  validatePromptSuggestionLength,
  validateNumberedSuggestion,
  type PromptSuggestionFormat,
  type PromptSuggestionMode,
} from "@/lib/promptSuggestions";
import { MAX_CREATIVE_PROMPT_LENGTH } from "@/lib/scenePromptScript";

type PromptSuggestionsProps = {
  mode: PromptSuggestionMode;
  imageCount: number;
  onUseExample: (prompt: string, numberedSceneCount?: number) => void;
};

export function PromptSuggestions({ mode, imageCount, onUseExample }: PromptSuggestionsProps) {
  const examples = PROMPT_SUGGESTIONS[mode];
  const [exampleId, setExampleId] = useState(examples[0]?.id ?? "");
  const [format, setFormat] = useState<PromptSuggestionFormat>("summary");
  const selectedExample = useMemo(
    () => examples.find((example) => example.id === exampleId) ?? examples[0],
    [exampleId, examples],
  );
  const generatedPreview = selectedExample
    ? formatPromptSuggestion(selectedExample, mode, format, imageCount)
    : "";
  const [preview, setPreview] = useState(generatedPreview);
  const [applied, setApplied] = useState(false);

  // A count change should update the generated image summary preview, but
  // never touch the user's actual Creative Prompt draft.
  useEffect(() => {
    setPreview(generatedPreview);
    setApplied(false);
  }, [generatedPreview]);

  if (!selectedExample) return null;

  const isImage = mode === "image";
  const numberedValidation =
    isImage && format === "numbered" ? validateNumberedSuggestion(preview, 30) : null;
  const lengthError = validatePromptSuggestionLength(preview, MAX_CREATIVE_PROMPT_LENGTH);
  const previewError = lengthError
    ?? (numberedValidation && !numberedValidation.valid ? numberedValidation.error : null);

  return (
    <section
      className="rounded-xl border border-primary/25 bg-primary/[0.045] p-3.5 sm:p-4"
      aria-labelledby="prompt-suggestions-heading"
      data-testid="prompt-suggestions"
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
          <Sparkles className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="prompt-suggestions-heading" className="text-sm font-semibold">
            Need a starting point?
          </h2>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            Choose a format, edit the preview, then explicitly use it in your {isImage ? "image pack" : "story"}.
            Toggling ideas never replaces your draft.
          </p>
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2" aria-label="Prompt example">
        {examples.map((example) => (
          <button
            key={example.id}
            type="button"
            className={`rounded-lg border px-3 py-2 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
              selectedExample.id === example.id
                ? "border-primary/60 bg-primary/10 text-primary"
                : "border-border/60 bg-background/45 text-muted-foreground hover:border-primary/40 hover:text-foreground"
            }`}
            aria-pressed={selectedExample.id === example.id}
            onClick={() => {
              setExampleId(example.id);
              setFormat("summary");
            }}
            data-testid={`prompt-example-${example.id}`}
          >
            <span className="font-medium">{example.title}</span>
          </button>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-2" aria-label="Prompt example format">
        <button
          type="button"
          aria-pressed={format === "summary"}
          className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
            format === "summary"
              ? "border-primary/60 bg-primary text-primary-foreground"
              : "border-border/60 bg-background/45 text-muted-foreground hover:border-primary/40 hover:text-foreground"
          }`}
          onClick={() => setFormat("summary")}
          data-testid="prompt-format-summary"
        >
          <TextQuote className="h-3.5 w-3.5" aria-hidden="true" />
          Summary story
        </button>
        <button
          type="button"
          aria-pressed={format === "numbered"}
          className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
            format === "numbered"
              ? "border-primary/60 bg-primary text-primary-foreground"
              : "border-border/60 bg-background/45 text-muted-foreground hover:border-primary/40 hover:text-foreground"
          }`}
          onClick={() => setFormat("numbered")}
          data-testid="prompt-format-numbered"
        >
          <ListOrdered className="h-3.5 w-3.5" aria-hidden="true" />
          Numbered scenes
        </button>
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
        {isImage
          ? format === "summary"
            ? `The summary will expand to your chosen ${imageCount} image${imageCount === 1 ? "" : "s"}.`
            : "Each numbered line becomes one image; using it sets the image count to match the list."
          : format === "summary"
            ? "The engine turns this summary into a chronological story across your selected video length."
            : "These are chronological story beats. They guide the story, but are not guaranteed to become one clip per line."}
      </p>

      <Textarea
        value={preview}
        onChange={(event) => {
          setPreview(event.target.value);
          setApplied(false);
        }}
        maxLength={MAX_CREATIVE_PROMPT_LENGTH}
        className="mt-2 min-h-28 resize-y bg-background/70 text-xs leading-relaxed"
        aria-label={`${selectedExample.title} ${format} preview`}
        aria-invalid={!!previewError}
        aria-describedby="prompt-suggestion-validation"
        data-testid="prompt-suggestion-preview"
      />
      {previewError && (
        <p
          id="prompt-suggestion-validation"
          className="mt-2 text-xs font-medium text-destructive"
          role="alert"
          data-testid="prompt-suggestion-error"
        >
          {previewError}
        </p>
      )}

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Free to use. Generated media costs credits. Have your own photos or clips?{" "}
          <Link href="/editor" className="font-medium text-primary underline-offset-2 hover:underline">
            Try Creator Studio
          </Link>{" "}
          with its trial.
        </p>
        <Button
          type="button"
          size="sm"
          className="w-full shrink-0 sm:w-auto"
          disabled={!preview.trim() || !!previewError}
          onClick={() => {
            if (previewError) return;
            onUseExample(
              preview.trim(),
              isImage && format === "numbered" ? numberedValidation?.count : undefined,
            );
            setApplied(true);
          }}
          data-testid="button-use-prompt-example"
        >
          {applied ? "Example applied" : "Use example"}
        </Button>
      </div>
      <p role="status" aria-live="polite" className="mt-2 text-xs text-primary">
        {applied ? "Example added to Creative Prompt above. Review it, then continue when ready. No credits used." : ""}
      </p>
    </section>
  );
}

export default PromptSuggestions;