export const OPTIONAL_FACTORY_METHOD_NAMES = new Set(["from", "some", "none"]);
export const OPTIONAL_WRAPPER_METHOD_NAMES = new Set(["map", "filter"]);
export const OPTIONAL_PROVIDER_MUTATION_METHOD_NAMES = new Set([
  "from",
  "some",
  "none",
  "map",
  "filter",
  "bind",
  "firstChild",
  "prototype",
]);
export const OPTIONAL_PROVIDER_HAZARD_NAMES = [
  "Object",
  "Reflect",
  "eval",
  "Function",
  "require",
  "module",
];
export const OPTIONAL_SINGLE_ARGUMENT_COUNT = 1;
export const OPTIONAL_NO_ARGUMENT_COUNT = 0;
export const OPTIONAL_BINDER_METHOD_NAMES = new Set(["firstChild"]);
export const STRUCTURED_CLONE_GLOBAL_OBJECT_NAMES = new Set([
  "global",
  "globalThis",
  "window",
  "self",
]);
export const STRUCTURED_CLONE_PROVIDER_NAMES = new Set([
  "document",
  "global",
  "globalThis",
  "window",
  "self",
  "jest",
  "JSON",
  "structuredClone",
  "eval",
  "Function",
]);
export const STRUCTURED_CLONE_GLOBAL_EXPOSURE_NAMES = new Set([
  "document",
  "global",
  "globalThis",
  "window",
  "self",
  "constructor",
  "prototype",
  "structuredClone",
  "jest",
  "JSON",
  "eval",
  "Function",
  "top",
  "parent",
  "frames",
]);

export const STRUCTURED_CLONE_SMALL_BRANCH_COUNT = 2;
export const STRUCTURED_CLONE_LARGE_BRANCH_COUNT = 64;

export const REACT_MARKDOWN_SINGLE_VALUE_COUNT = 1;

export const REACT_MARKDOWN_FIRST_VALUE_INDEX = 0;

export const REACT_MARKDOWN_RUNTIME_TYPESCRIPT_NODES = new Set([
  "TSImportEqualsDeclaration",
  "TSExportAssignment",
  "TSParameterProperty",
]);

export const REACT_MARKDOWN_SMALL_LOOKUP_COUNT = 20;

export const REACT_MARKDOWN_LARGE_LOOKUP_COUNT = 100;

export const REACT_MARKDOWN_MAXIMUM_WORK_MULTIPLIER = 8;
