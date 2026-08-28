export type CharacterAnchorAsset = {
  assetIndex: number;
  objectPath: string;
};

export type CharacterAnchorScene = {
  index: number;
  usesCharacterReference?: boolean;
};

export function selectGeneratedCharacterAnchorPath(
  assets: CharacterAnchorAsset[],
  scenes: CharacterAnchorScene[],
  userReferenceImagePath: string | null | undefined,
): string | undefined {
  if (userReferenceImagePath) return undefined;
  const sceneByIndex = new Map(scenes.map((scene) => [scene.index, scene]));
  return assets
    .filter((asset) => sceneByIndex.get(asset.assetIndex)?.usesCharacterReference === true)
    .sort((a, b) => a.assetIndex - b.assetIndex)[0]?.objectPath;
}

export function resolveCharacterReferencePath(input: {
  usesCharacterReference: boolean;
  userReferenceImagePath: string | null | undefined;
  generatedCharacterAnchorPath: string | undefined;
}): string | undefined {
  if (!input.usesCharacterReference) return undefined;
  return input.userReferenceImagePath ?? input.generatedCharacterAnchorPath;
}