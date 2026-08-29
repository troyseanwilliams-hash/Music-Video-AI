export const MAX_SCENE_SCRIPT_HANDOFF_LENGTH = 12_000;
const SCENE_SCRIPT_HANDOFF_KEY = "beatvision:scene-script-handoff";
const HANDOFF_VERSION = 2;

type HandoffStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type SceneScriptHandoff = {
  version: 2;
  mode: "montage" | "narrative";
  script: string;
};

export function saveSceneScriptHandoff(
  input: string | Omit<SceneScriptHandoff, "version">,
  storage: HandoffStorage = window.sessionStorage,
): boolean {
  const mode = typeof input === "string" ? "montage" : input.mode;
  const normalized = (typeof input === "string" ? input : input.script).trim();
  if (!normalized || normalized.length > MAX_SCENE_SCRIPT_HANDOFF_LENGTH) return false;
  storage.setItem(SCENE_SCRIPT_HANDOFF_KEY, JSON.stringify({
    version: HANDOFF_VERSION,
    mode,
    script: normalized,
  }));
  return true;
}

export function consumeSceneScriptHandoff(storage: HandoffStorage = window.sessionStorage): SceneScriptHandoff | null {
  const value = storage.getItem(SCENE_SCRIPT_HANDOFF_KEY);
  storage.removeItem(SCENE_SCRIPT_HANDOFF_KEY);
  const normalized = value?.trim() ?? "";
  if (!normalized) return null;
  try {
    const parsed = JSON.parse(normalized) as Partial<SceneScriptHandoff>;
    if (
      parsed.version === HANDOFF_VERSION
      && (parsed.mode === "montage" || parsed.mode === "narrative")
      && typeof parsed.script === "string"
      && parsed.script.trim()
      && parsed.script.trim().length <= MAX_SCENE_SCRIPT_HANDOFF_LENGTH
    ) {
      return { version: 2, mode: parsed.mode, script: parsed.script.trim() };
    }
  } catch {
    // Backward-compatible consumption of the previous plain-string handoff.
  }
  return normalized.length <= MAX_SCENE_SCRIPT_HANDOFF_LENGTH
    ? { version: 2, mode: "montage", script: normalized }
    : null;
}