export type TerminalSceneRecoveryMeta = {
  pendingRequests?: Record<string, unknown>;
  rejectedRequests?: Record<string, unknown>;
  storyboard?: {
    numClips?: number;
  };
};

export type TerminalSceneRecovery = {
  sceneKey: string | null;
  unsafe: boolean;
};

const TERMINAL_SCENE_ERROR = /request was rejected|ai scene (failed|error)/i;

function isValidPlannedSceneKey(
  key: string,
  plannedScenes: number | undefined,
): boolean {
  if (!Number.isInteger(plannedScenes) || (plannedScenes ?? 0) <= 0) return false;
  if (!/^(0|[1-9]\d*)$/.test(key)) return false;
  const index = Number(key);
  return index >= 0 && index < plannedScenes!;
}

export function terminalSceneRecovery(
  meta: TerminalSceneRecoveryMeta,
  errorMessage: string | null,
): TerminalSceneRecovery {
  const plannedScenes = meta.storyboard?.numClips;
  const rejectedKeys = Object.keys(meta.rejectedRequests ?? {});
  if (rejectedKeys.length > 1) return { sceneKey: null, unsafe: true };
  if (rejectedKeys.length === 1) {
    const sceneKey = rejectedKeys[0]!;
    return isValidPlannedSceneKey(sceneKey, plannedScenes)
      ? { sceneKey, unsafe: false }
      : { sceneKey: null, unsafe: true };
  }

  if (!TERMINAL_SCENE_ERROR.test(errorMessage ?? "")) {
    return { sceneKey: null, unsafe: false };
  }

  const pendingKeys = Object.keys(meta.pendingRequests ?? {});
  if (pendingKeys.length !== 1) return { sceneKey: null, unsafe: true };

  const sceneKey = pendingKeys[0]!;
  return isValidPlannedSceneKey(sceneKey, plannedScenes)
    ? { sceneKey, unsafe: false }
    : { sceneKey: null, unsafe: true };
}