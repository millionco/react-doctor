import { DEFAULT_TRANSPARENT_MATERIAL_CONSTRUCTOR_NAMES } from "../constants.js";

export const isThreeMaterialTransparentByDefault = (materialName: string): boolean => {
  const canonicalMaterialName = `${materialName.charAt(0).toUpperCase()}${materialName.slice(1)}`;
  return DEFAULT_TRANSPARENT_MATERIAL_CONSTRUCTOR_NAMES.has(canonicalMaterialName);
};
