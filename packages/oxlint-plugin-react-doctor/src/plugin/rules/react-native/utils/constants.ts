export const FIRST_NATIVE_PROP_BINDING_INDEX = 0;
export const FORWARD_REF_CALLBACK_ARGUMENT_COUNT = 1;
export const FORWARD_REF_MAX_PARAMETER_COUNT = 2;
export const SINGLE_STRING_PROP_DECLARATION_COUNT = 1;
export const STRING_PROP_RUNTIME_TYPESCRIPT_NODES: ReadonlySet<string> = new Set([
  "TSImportEqualsDeclaration",
  "TSExportAssignment",
  "TSParameterProperty",
]);

export const STRING_PROP_PROVIDER_HAZARD_NAMES: ReadonlyArray<string> = [
  "React",
  "require",
  "module",
  "Function",
  "eval",
];
export const STRING_PROP_GLOBAL_CARRIER_NAMES: ReadonlySet<string> = new Set([
  "globalThis",
  "window",
  "self",
  "global",
]);

export const STRING_PROP_PROVIDER_ESCAPE_MEMBER_NAMES: ReadonlySet<string> = new Set([
  "constructor",
  "__proto__",
]);

export const IMPORTED_IMAGE_SINGLE_ITEM_COUNT = 1;

export const IMPORTED_IMAGE_FIRST_ITEM_INDEX = 0;

export const IMPORTED_IMAGE_RUNTIME_TYPESCRIPT_NODES = new Set([
  "TSEnumDeclaration",
  "TSModuleDeclaration",
  "TSImportEqualsDeclaration",
  "TSExportAssignment",
  "TSParameterProperty",
]);

export const IMPORTED_IMAGE_UNSUPPORTED_GLOBAL_NAMES = new Set([
  "eval",
  "Function",
  "Object",
  "Reflect",
  "globalThis",
  "window",
  "self",
  "global",
  "require",
  "module",
]);

export const IMPORTED_IMAGE_UNSUPPORTED_MEMBER_NAMES = new Set([
  "prototype",
  "constructor",
  "__proto__",
]);
