export const MAX_SHADOWED_POINT_LIGHT_COUNT = 2;
export const THREE_INTERPOLATION_FACTOR_ARGUMENT_BY_METHOD = new Map<string, number>([
  ["lerp", 1],
  ["lerpColors", 2],
  ["lerpHSL", 1],
  ["lerpVectors", 2],
  ["slerp", 1],
  ["slerpQuaternions", 2],
]);
export const THREE_MATH_UTILS_LERP_FACTOR_ARGUMENT_INDEX = 2;
export const MINIMUM_PROVABLY_REPEATED_ITEM_COUNT = 2;
export const LIFECYCLE_ANALYSIS_LARGE_ALLOCATION_COUNT = 2_000;
export const LIFECYCLE_ANALYSIS_DENSE_EFFECT_COUNT = 100;
export const THREE_PASS_DISPOSAL_BASE_RELEASE = 145;
export const THREE_POSTPROCESSING_COMPOSER_DISPOSAL_RELEASE = 146;
export const THREE_POSTPROCESSING_BARREL_RELEASE = 158;
export const THREE_POSTPROCESSING_PASS_DISPOSAL_RELEASES = new Map<string, number>([
  ["RenderPixelatedPass", 147],
  ["OutputPass", 153],
  ["GTAOPass", 160],
  ["RenderTransitionPass", 164],
  ["FXAAPass", 177],
]);
