export const INLINE_MAP_ARGUMENT_COUNT = 1;
export const INLINE_MAP_FIRST_ARGUMENT_INDEX = 0;
export const INLINE_MAP_MINIMUM_ELEMENT_INDEX = 0;

export const INLINE_MAP_ARRAY_STATIC_METHOD_NAMES = new Set(["from", "isArray", "of"]);

export const INLINE_MAP_PROTOTYPE_METHOD_NAMES = new Set(["getPrototypeOf", "setPrototypeOf"]);

export const INLINE_MAP_RUNTIME_TYPESCRIPT_NODES = new Set([
  "TSEnumDeclaration",
  "TSModuleDeclaration",
  "TSImportEqualsDeclaration",
  "TSExportAssignment",
  "TSParameterProperty",
]);

export const INLINE_MAP_EVENT_ATTRIBUTE_COUNT = 1;
export const INLINE_MAP_NATIVE_EVENT_NAMES = new Set(["onClick", "onMouseEnter"]);

export const INLINE_MAP_EFFECT_DEPENDENCIES_ARGUMENT_INDEX = 1;
