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
export const ARRAY_MAP_CALLBACK_ARGUMENT_INDEX = 0;
export const THREE_MESH_GEOMETRY_ARGUMENT_INDEX = 0;
export const THREE_MESH_MATERIAL_ARGUMENT_INDEX = 1;
export const LIFECYCLE_ANALYSIS_LARGE_ALLOCATION_COUNT = 2_000;
export const LIFECYCLE_ANALYSIS_DENSE_EFFECT_COUNT = 100;
export const GLSL_INTEGER_BIT_WIDTH = 32;
export const GLSL_MAX_LDEXP_EXPONENT = 128;
export const GLSL_POSITION_COMPONENT_BIT_BY_ALIAS: ReadonlyMap<string, number> = new Map([
  ["x", 0b0001],
  ["r", 0b0001],
  ["s", 0b0001],
  ["y", 0b0010],
  ["g", 0b0010],
  ["t", 0b0010],
  ["z", 0b0100],
  ["b", 0b0100],
  ["p", 0b0100],
  ["w", 0b1000],
  ["a", 0b1000],
  ["q", 0b1000],
]);
export const GLSL_NO_POSITION_COMPONENTS_BIT_MASK = 0b0000;
export const GLSL_ALL_POSITION_COMPONENTS_BIT_MASK = 0b1111;
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
  "ambientLightColor",
  "bindMatrix",
  "bindMatrixInverse",
  "boneTexture",
  "boneTextureSize",
  "cameraPosition",
  "clippingPlanes",
  "directionalLights",
  "directionalLightShadows",
  "directionalShadowMap",
  "directionalShadowMatrix",
  "fogColor",
  "fogDensity",
  "fogFar",
  "fogNear",
  "hemisphereLights",
  "isOrthographic",
  "lightProbe",
  "logDepthBufFC",
  "ltc_1",
  "ltc_2",
  "modelMatrix",
  "modelViewMatrix",
  "morphTargetBaseInfluence",
  "morphTargetInfluences",
  "morphTargetsTexture",
  "morphTargetsTextureSize",
  "normalMatrix",
  "pointLights",
  "pointLightShadows",
  "pointShadowMap",
  "pointShadowMatrix",
  "probesMax",
  "probesMin",
  "probesResolution",
  "probesSH",
  "projectionMatrix",
  "receiveShadow",
  "rectAreaLights",
  "spotLightMap",
  "spotLightMatrix",
  "spotLights",
  "spotLightShadows",
  "spotShadowMap",
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
