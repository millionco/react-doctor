export const MAX_RETURNED_SETTER_EXPRESSIONS = 64;

export const NEXT_PAGE_REDIRECT_SINGLE_ITEM_COUNT = 1;
export const NEXT_PAGE_REDIRECT_PROVIDER_MODULES = new Set(["react", "next/router"]);
export const NEXT_PAGE_REDIRECT_LOADER_MODULES = new Set(["module", "node:module"]);
export const NEXT_PAGE_REDIRECT_DYNAMIC_GLOBALS = new Set([
  "eval",
  "Function",
  "require",
  "module",
  "React",
]);
export const NEXT_PAGE_REDIRECT_GLOBAL_OBJECTS = new Set([
  "global",
  "globalThis",
  "window",
  "self",
  "frames",
  "top",
  "parent",
  "opener",
]);
export const NEXT_PAGE_REDIRECT_EXPOSED_PROPERTIES = new Set([
  "constructor",
  "prototype",
  "__proto__",
]);
export const NEXT_PAGE_REDIRECT_RUNTIME_TYPES = new Set([
  "TSImportEqualsDeclaration",
  "TSModuleDeclaration",
  "TSEnumDeclaration",
  "TSExportAssignment",
  "TSParameterProperty",
]);

export const NEXT_PAGE_REDIRECT_EFFECT_ARGUMENT_COUNT = 2;
export const NEXT_PAGE_REDIRECT_PAGE_FILE_PATTERN =
  /^(?:src\/)?pages\/(?!api\/|_(?:app|document|error)\.).+\.[jt]sx?$/;
