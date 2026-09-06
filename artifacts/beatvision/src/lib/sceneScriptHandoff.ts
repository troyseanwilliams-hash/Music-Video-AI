export const MAX_SCENE_SCRIPT_HANDOFF_LENGTH = 12_000;
const SCENE_SCRIPT_HANDOFF_KEY = "beatvision:scene-script-handoff";
const HANDOFF_VERSION = 3;

type HandoffStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type SceneScriptHandoffAudio = {
  title: string;
  objectPath: string;
  durationSeconds?: number;
};

export type SceneScriptHandoffPlanner = {
  fingerprint: string;
  settings?: {
    style?: string;
    hasReferenceImage?: boolean;
    requestedDuration?: string;
  };
};

export type SceneScriptHandoff = {
  version: 3;
  mode: "montage" | "narrative";
  script: string;
  /** The unmodified story lets Generate explain what the numbered script represents. */
  originalStory?: string;
  /** A user-owned track selected while the exact script was planned. */
  audio?: SceneScriptHandoffAudio;
  /** Planner inputs identify a plan without trusting it after settings change. */
  planner?: SceneScriptHandoffPlanner;
};

export function saveSceneScriptHandoff(
  input: string | Omit<SceneScriptHandoff, "version">,
  storage: HandoffStorage = window.sessionStorage,
): boolean {
  const mode = typeof input === "string" ? "montage" : input.mode;
  const normalized = (typeof input === "string" ? input : input.script).trim();
  if (!normalized || normalized.length > MAX_SCENE_SCRIPT_HANDOFF_LENGTH) return false;
  const originalStory = typeof input === "string" ? undefined : input.originalStory?.trim();
  const audio = typeof input === "string" ? undefined : input.audio;
  const planner = typeof input === "string" ? undefined : input.planner;
  if (
    (originalStory && originalStory.length > MAX_SCENE_SCRIPT_HANDOFF_LENGTH)
    || (audio && (!audio.title.trim() || !audio.objectPath.startsWith("/objects/")))
    || (audio?.durationSeconds !== undefined
      && (!Number.isFinite(audio.durationSeconds) || audio.durationSeconds <= 0))
    || (planner && !planner.fingerprint.trim())
  ) return false;
  const handoff: SceneScriptHandoff = {
    version: HANDOFF_VERSION,
    mode,
    script: normalized,
    ...(originalStory ? { originalStory } : {}),
    ...(audio ? {
      audio: {
        title: audio.title.trim(),
        objectPath: audio.objectPath,
        ...(audio.durationSeconds !== undefined ? { durationSeconds: audio.durationSeconds } : {}),
      },
    } : {}),
    ...(planner ? {
      planner: {
        fingerprint: planner.fingerprint.trim(),
        ...(planner.settings ? { settings: planner.settings } : {}),
      },
    } : {}),
  };
  storage.setItem(SCENE_SCRIPT_HANDOFF_KEY, JSON.stringify(handoff));
  return true;
}

export function consumeSceneScriptHandoff(storage: HandoffStorage = window.sessionStorage): SceneScriptHandoff | null {
  const value = storage.getItem(SCENE_SCRIPT_HANDOFF_KEY);
  storage.removeItem(SCENE_SCRIPT_HANDOFF_KEY);
  const normalized = value?.trim() ?? "";
  if (!normalized) return null;
  try {
    const parsed = JSON.parse(normalized) as Partial<Omit<SceneScriptHandoff, "version">> & {
      version?: number;
    };
    if (
      parsed.version === HANDOFF_VERSION
      && (parsed.mode === "montage" || parsed.mode === "narrative")
      && typeof parsed.script === "string"
      && parsed.script.trim()
      && parsed.script.trim().length <= MAX_SCENE_SCRIPT_HANDOFF_LENGTH
    ) {
      const originalStory = typeof parsed.originalStory === "string"
        && parsed.originalStory.trim().length <= MAX_SCENE_SCRIPT_HANDOFF_LENGTH
        ? parsed.originalStory.trim()
        : undefined;
      const audio = parsed.audio
        && typeof parsed.audio.title === "string"
        && parsed.audio.title.trim()
        && typeof parsed.audio.objectPath === "string"
        && parsed.audio.objectPath.startsWith("/objects/")
        && (parsed.audio.durationSeconds === undefined
          || (typeof parsed.audio.durationSeconds === "number"
            && Number.isFinite(parsed.audio.durationSeconds)
            && parsed.audio.durationSeconds > 0))
        ? {
            title: parsed.audio.title.trim(),
            objectPath: parsed.audio.objectPath,
            ...(typeof parsed.audio.durationSeconds === "number"
              ? { durationSeconds: parsed.audio.durationSeconds }
              : {}),
          }
        : undefined;
      const planner = parsed.planner
        && typeof parsed.planner.fingerprint === "string"
        && parsed.planner.fingerprint.trim()
        ? parsed.planner
        : undefined;
      return {
        version: 3,
        mode: parsed.mode,
        script: parsed.script.trim(),
        ...(originalStory ? { originalStory } : {}),
        ...(audio ? { audio } : {}),
        ...(planner ? { planner } : {}),
      };
    }
    // Version 2 stored only mode and script. Retain it so existing in-flight
    // Prompt Studio handoffs continue to work after this upgrade.
    if (
      parsed.version === 2
      && (parsed.mode === "montage" || parsed.mode === "narrative")
      && typeof parsed.script === "string"
      && parsed.script.trim()
      && parsed.script.trim().length <= MAX_SCENE_SCRIPT_HANDOFF_LENGTH
    ) {
      return { version: 3, mode: parsed.mode, script: parsed.script.trim() };
    }
  } catch {
    // Backward-compatible consumption of the previous plain-string handoff.
  }
  return normalized.length <= MAX_SCENE_SCRIPT_HANDOFF_LENGTH
    ? { version: 3, mode: "montage", script: normalized }
    : null;
}