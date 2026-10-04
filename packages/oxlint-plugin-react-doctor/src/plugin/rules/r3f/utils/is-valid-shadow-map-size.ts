import { MINIMUM_SHADOW_MAP_SIZE_PX } from "../constants.js";

export const isValidShadowMapSize = (value: number): boolean =>
  Number.isInteger(value) &&
  value >= MINIMUM_SHADOW_MAP_SIZE_PX &&
  Number.isInteger(Math.log2(value));
