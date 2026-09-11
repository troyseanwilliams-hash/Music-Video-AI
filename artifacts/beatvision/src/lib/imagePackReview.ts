export interface ImagePackReviewScene {
  index: number;
  prompt: string;
}

export const MAX_IMAGE_PACK_SCENE_PROMPT_LENGTH = 1_000;

/**
 * Keep client-side approval checks aligned with the server's pre-charge
 * validation. The scene index is part of the contract: accepting a response
 * with reordered scenes would make a numbered script appear to change order.
 */
export function isImagePackPlanValid(
  scenes: ImagePackReviewScene[] | null | undefined,
  expectedCount: number,
): scenes is ImagePackReviewScene[] {
  if (!scenes || scenes.length !== expectedCount) return false;

  const prompts = scenes.map((scene, index) => {
    if (
      scene.index !== index
      || typeof scene.prompt !== "string"
      || scene.prompt.trim().length === 0
      || scene.prompt.trim().length > MAX_IMAGE_PACK_SCENE_PROMPT_LENGTH
    ) {
      return null;
    }
    return scene.prompt.trim().replace(/\s+/g, " ").toLocaleLowerCase();
  });

  return prompts.every((prompt): prompt is string => prompt !== null)
    && new Set(prompts).size === prompts.length;
}

/** Update one scene without mutating the response or changing its order. */
export function updateImagePackScenePrompt(
  scenes: ImagePackReviewScene[],
  sceneIndex: number,
  prompt: string,
): ImagePackReviewScene[] {
  return scenes.map((scene) =>
    scene.index === sceneIndex ? { ...scene, prompt } : scene,
  );
}

/**
 * A plan response is only useful while the same review request is current.
 * This guard covers both changed scripts and dialogs closed before a response
 * arrives.
 */
export function isCurrentImagePackPlanRequest(
  requestId: number,
  activeRequestId: number,
  confirmOpen: boolean,
  imagePackMode: boolean,
): boolean {
  return requestId === activeRequestId && confirmOpen && imagePackMode;
}