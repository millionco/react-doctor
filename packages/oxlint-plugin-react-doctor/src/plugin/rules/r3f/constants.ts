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
export const GLSL_INTEGER_BIT_WIDTH = 32;
export const GLSL_MAX_LDEXP_EXPONENT = 128;
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
export const THREE_RENDERER_MANAGED_SHADER_UNIFORM_NAMES: ReadonlySet<string> = new Set([
  "bindMatrix",
  "bindMatrixInverse",
  "boneTexture",
  "boneTextureSize",
  "cameraPosition",
  "clippingPlanes",
  "isOrthographic",
  "logDepthBufFC",
  "modelMatrix",
  "modelViewMatrix",
  "morphTargetBaseInfluence",
  "morphTargetInfluences",
  "morphTargetsTexture",
  "morphTargetsTextureSize",
  "normalMatrix",
  "projectionMatrix",
  "receiveShadow",
  "toneMappingExposure",
  "transmissionSamplerMap",
  "transmissionSamplerSize",
  "viewMatrix",
]);
export const THREE_SHADER_MATERIAL_INJECTED_FRAGMENT_NAMES: ReadonlySet<string> = new Set([
  "cameraPosition",
  "isOrthographic",
  "viewMatrix",
]);
export const THREE_SHADER_MATERIAL_INJECTED_VERTEX_NAMES: ReadonlySet<string> = new Set([
  "cameraPosition",
  "isOrthographic",
  "modelMatrix",
  "modelViewMatrix",
  "normal",
  "normalMatrix",
  "position",
  "projectionMatrix",
  "uv",
  "viewMatrix",
]);
