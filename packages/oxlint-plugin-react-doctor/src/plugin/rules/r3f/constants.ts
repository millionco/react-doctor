export const MAX_SHADOWED_POINT_LIGHT_COUNT = 2;
export const MINIMUM_NORMALIZED_MATERIAL_FACTOR = 0;
export const MAXIMUM_NORMALIZED_MATERIAL_FACTOR = 1;
export const MINIMUM_MATERIAL_OPACITY = 0;
export const MAXIMUM_MATERIAL_OPACITY = 1;
export const MINIMUM_PERSPECTIVE_CAMERA_ASPECT = 0;
export const MINIMUM_PERSPECTIVE_CAMERA_NEAR = 0;
export const PERSPECTIVE_CAMERA_ASPECT_ARGUMENT_INDEX = 1;
export const PERSPECTIVE_CAMERA_NEAR_ARGUMENT_INDEX = 2;
export const PERSPECTIVE_CAMERA_FAR_ARGUMENT_INDEX = 3;
export const ORTHOGRAPHIC_CAMERA_LEFT_ARGUMENT_INDEX = 0;
export const ORTHOGRAPHIC_CAMERA_RIGHT_ARGUMENT_INDEX = 1;
export const ORTHOGRAPHIC_CAMERA_TOP_ARGUMENT_INDEX = 2;
export const ORTHOGRAPHIC_CAMERA_BOTTOM_ARGUMENT_INDEX = 3;
export const ORTHOGRAPHIC_CAMERA_NEAR_ARGUMENT_INDEX = 4;
export const ORTHOGRAPHIC_CAMERA_FAR_ARGUMENT_INDEX = 5;
export const RAYCASTER_NEAR_ARGUMENT_INDEX = 2;
export const RAYCASTER_FAR_ARGUMENT_INDEX = 3;
export const MINIMUM_RAYCASTER_NEAR = 0;
export const BUFFER_ATTRIBUTE_ARRAY_ARGUMENT_INDEX = 0;
export const BUFFER_ATTRIBUTE_ITEM_SIZE_ARGUMENT_INDEX = 1;
export const BUFFER_ATTRIBUTE_NORMALIZED_ARGUMENT_INDEX = 2;
export const THREE_BUFFER_ATTRIBUTE_CONSTRUCTOR_NAMES: ReadonlySet<string> = new Set([
  "BufferAttribute",
  "Float16BufferAttribute",
  "Float32BufferAttribute",
  "InstancedBufferAttribute",
  "Int16BufferAttribute",
  "Int32BufferAttribute",
  "Int8BufferAttribute",
  "Uint16BufferAttribute",
  "Uint32BufferAttribute",
  "Uint8BufferAttribute",
  "Uint8ClampedBufferAttribute",
]);
export const MINIMUM_BUFFER_ATTRIBUTE_ITEM_SIZE = 1;
export const GPU_LINE_WIDTH_PX = 1;
export const SPOT_LIGHT_ANGLE_ARGUMENT_INDEX = 3;
export const SPOT_LIGHT_PENUMBRA_ARGUMENT_INDEX = 4;
export const MINIMUM_SPOT_LIGHT_ANGLE_RADIANS = 0;
export const MAXIMUM_SPOT_LIGHT_ANGLE_RADIANS = Math.PI / 2;
export const MINIMUM_SPOT_LIGHT_PENUMBRA = 0;
export const MAXIMUM_SPOT_LIGHT_PENUMBRA = 1;
export const MINIMUM_SHADOW_MAP_SIZE_PX = 1;
export const DEFAULT_TEXTURE_REPEAT = 1;
export const PHYSICAL_MATERIAL_NORMALIZED_PROPERTY_NAMES: ReadonlySet<string> = new Set([
  "anisotropy",
  "clearcoat",
  "clearcoatRoughness",
  "iridescence",
  "reflectivity",
  "sheen",
  "sheenRoughness",
  "specularIntensity",
  "transmission",
]);
export const PHYSICAL_MATERIAL_IOR_PROPERTY_NAMES: ReadonlySet<string> = new Set([
  "ior",
  "iridescenceIOR",
]);
export const MINIMUM_PHYSICAL_MATERIAL_IOR = 1;
export const MAXIMUM_PHYSICAL_MATERIAL_IOR = 2.333;
export const FLOAT_TYPED_ARRAY_CONSTRUCTOR_NAMES: ReadonlySet<string> = new Set([
  "Float16Array",
  "Float32Array",
  "Float64Array",
]);
export const FOG_NEAR_ARGUMENT_INDEX = 1;
export const FOG_FAR_ARGUMENT_INDEX = 2;
export const FOG_EXPONENTIAL_DENSITY_ARGUMENT_INDEX = 1;
export const DEFAULT_FOG_NEAR = 1;
export const DEFAULT_FOG_FAR = 1_000;
export const MINIMUM_FOG_PARAMETER = 0;
export const MESH_BASIC_MATERIAL_IGNORED_PBR_PROPERTY_NAMES: ReadonlySet<string> = new Set([
  "metalness",
  "roughness",
]);
export const PBR_MATERIAL_CONSTRUCTOR_NAMES: ReadonlySet<string> = new Set([
  "MeshPhysicalMaterial",
  "MeshStandardMaterial",
]);
export const DEFAULT_TRANSPARENT_MATERIAL_CONSTRUCTOR_NAMES: ReadonlySet<string> = new Set([
  "ShadowMaterial",
  "ShadowNodeMaterial",
  "SpriteMaterial",
  "SpriteNodeMaterial",
  "VolumeNodeMaterial",
]);
export const UNSUPPORTED_SHADOW_LIGHT_CONSTRUCTOR_NAMES: ReadonlySet<string> = new Set([
  "AmbientLight",
  "HemisphereLight",
  "RectAreaLight",
]);
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
export const DATA_TEXTURE_DATA_ARGUMENT_INDEX = 0;
export const DATA_TEXTURE_WIDTH_ARGUMENT_INDEX = 1;
export const DATA_TEXTURE_HEIGHT_ARGUMENT_INDEX = 2;
export const DATA_TEXTURE_DEPTH_ARGUMENT_INDEX = 3;
export const DATA_TEXTURE_FORMAT_ARGUMENT_INDEX = 3;
export const DATA_VOLUME_TEXTURE_FORMAT_ARGUMENT_INDEX = 4;
export const DATA_TEXTURE_TYPE_ARGUMENT_INDEX = 4;
export const DATA_VOLUME_TEXTURE_TYPE_ARGUMENT_INDEX = 5;
export const DEFAULT_DATA_TEXTURE_DIMENSION_PX = 1;
export const DATA_TEXTURE_FORMAT_COMPONENT_COUNT_BY_NAME: ReadonlyMap<string, number> = new Map([
  ["AlphaFormat", 1],
  ["LuminanceFormat", 1],
  ["LuminanceAlphaFormat", 2],
  ["RedFormat", 1],
  ["RedIntegerFormat", 1],
  ["RGFormat", 2],
  ["RGIntegerFormat", 2],
  ["RGBFormat", 3],
  ["RGBAFormat", 4],
  ["RGBAIntegerFormat", 4],
]);
export const DATA_TEXTURE_UNPACKED_TYPE_NAMES: ReadonlySet<string> = new Set([
  "ByteType",
  "FloatType",
  "HalfFloatType",
  "IntType",
  "ShortType",
  "UnsignedByteType",
  "UnsignedIntType",
  "UnsignedShortType",
]);
export const GLSL_FLAT_VALUE_COUNT_BY_TYPE_NAME: ReadonlyMap<string, number> = new Map([
  ["bvec2", 2],
  ["bvec3", 3],
  ["bvec4", 4],
  ["ivec2", 2],
  ["ivec3", 3],
  ["ivec4", 4],
  ["mat2", 4],
  ["mat3", 9],
  ["mat4", 16],
  ["uvec2", 2],
  ["uvec3", 3],
  ["uvec4", 4],
  ["vec2", 2],
  ["vec3", 3],
  ["vec4", 4],
]);
export const GPU_COMPUTATION_WIDTH_ARGUMENT_INDEX = 0;
export const GPU_COMPUTATION_HEIGHT_ARGUMENT_INDEX = 1;
export const GPU_COMPUTATION_VARIABLE_NAME_ARGUMENT_INDEX = 0;
export const MINIMUM_GPU_COMPUTATION_DIMENSION_PX = 1;
