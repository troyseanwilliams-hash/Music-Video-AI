export type TerminalSceneRecoveryMeta = {
  pendingRequests?: Record<string, unknown>;
  rejectedRequests?: Record<string, unknown>;
  generationProvider?: string;
  storyboard?: {
    numClips?: number;
  };
};

function providerFromRequest(value: unknown): string | null {
  if (typeof value === "string") {
    return value.toLowerCase().includes("runway") ? "runway" : null;
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.provider === "string") return record.provider.toLowerCase();
  if (typeof record.pollUrl === "string" && record.pollUrl.toLowerCase().includes("runway")) {
    return "runway";
  }
  return null;
}

function isLegacyRunwayGatewayRequest(value: unknown): boolean {
  if (typeof value === "string") {
    const normalized = value.toLowerCase();
    return normalized.includes("gateway.pixazo.ai") && normalized.includes("runway");
  }
  if (!value || typeof value !== "object") return false;
  const pollUrl = (value as Record<string, unknown>).pollUrl;
  if (typeof pollUrl !== "string") return false;
  const normalized = pollUrl.toLowerCase();
  return normalized.includes("gateway.pixazo.ai") && normalized.includes("runway");
}

export function retryProviderAfterTerminalFailure(
  meta: TerminalSceneRecoveryMeta,
  currentProvider: string | null,
  sceneKey: string | null,
): string | null {
  if (sceneKey === null) return currentProvider;
  const rejectedProvider = providerFromRequest(meta.rejectedRequests?.[sceneKey]);
  const pendingProvider = providerFromRequest(meta.pendingRequests?.[sceneKey]);
  const sceneProvider = rejectedProvider ?? pendingProvider;
  if (sceneProvider) {
    const sceneRequest =
      rejectedProvider ? meta.rejectedRequests?.[sceneKey] : meta.pendingRequests?.[sceneKey];
    if (sceneProvider === "runway" && isLegacyRunwayGatewayRequest(sceneRequest)) {
      return "runway";
    }
    return sceneProvider === "runway" ? "kling" : currentProvider;
  }
  const pinnedProvider = meta.generationProvider?.toLowerCase();
  const selectedProvider = currentProvider?.toLowerCase() ?? null;
  return [pinnedProvider, selectedProvider].includes("runway")
    ? "kling"
    : currentProvider;
}

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