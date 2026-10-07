const COLOR_TEXTURE_PROPERTY_NAMES: ReadonlySet<string> = new Set([
  "emissiveMap",
  "map",
  "sheenColorMap",
  "specularColorMap",
]);

const DATA_TEXTURE_PROPERTY_NAMES: ReadonlySet<string> = new Set([
  "alphaMap",
  "aoMap",
  "bumpMap",
  "clearcoatMap",
  "clearcoatNormalMap",
  "clearcoatRoughnessMap",
  "displacementMap",
  "metalnessMap",
  "normalMap",
  "roughnessMap",
  "sheenRoughnessMap",
  "specularIntensityMap",
  "thicknessMap",
  "transmissionMap",
]);

export const getExpectedTextureColorSpace = (
  materialPropertyName: string,
): "NoColorSpace" | "SRGBColorSpace" | null => {
  if (COLOR_TEXTURE_PROPERTY_NAMES.has(materialPropertyName)) return "SRGBColorSpace";
  if (DATA_TEXTURE_PROPERTY_NAMES.has(materialPropertyName)) return "NoColorSpace";
  return null;
};
