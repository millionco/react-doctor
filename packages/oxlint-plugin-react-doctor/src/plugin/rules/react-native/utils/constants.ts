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
