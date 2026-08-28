export const MAX_SCENE_SCRIPT_HANDOFF_LENGTH = 12_000;
const SCENE_SCRIPT_HANDOFF_KEY = "beatvision:scene-script-handoff";

type HandoffStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function saveSceneScriptHandoff(script: string, storage: HandoffStorage = window.sessionStorage): boolean {
  const normalized = script.trim();
  if (!normalized || normalized.length > MAX_SCENE_SCRIPT_HANDOFF_LENGTH) return false;
  storage.setItem(SCENE_SCRIPT_HANDOFF_KEY, normalized);
  return true;
}

export function consumeSceneScriptHandoff(storage: HandoffStorage = window.sessionStorage): string | null {
  const value = storage.getItem(SCENE_SCRIPT_HANDOFF_KEY);
  storage.removeItem(SCENE_SCRIPT_HANDOFF_KEY);
  const normalized = value?.trim() ?? "";
  return normalized && normalized.length <= MAX_SCENE_SCRIPT_HANDOFF_LENGTH ? normalized : null;
}