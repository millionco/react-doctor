export const NODE_PATH_ALIAS_BINDING_LIMIT = 2;
export const NODE_PATH_SINGLE_ARGUMENT_COUNT = 1;
export const NODE_PATH_REPLACE_ARGUMENT_COUNT = 2;
export const NODE_PATH_MODULE_NAMES = new Set(["path", "node:path"]);
export const NODE_MODULE_LOADER_NAMES = new Set([
  "module",
  "node:module",
  "process",
  "node:process",
  "vm",
  "node:vm",
  "repl",
  "node:repl",
  "inspector",
  "node:inspector",
  "inspector/promises",
  "node:inspector/promises",
]);
export const NODE_FS_MODULE_NAMES = new Set(["fs", "node:fs"]);
export const NODE_PATH_FORBIDDEN_SELECTORS = new Set([
  "constructor",
  "prototype",
  "__proto__",
  "getPrototypeOf",
  "setPrototypeOf",
  "getOwnPropertyDescriptor",
  "getOwnPropertyDescriptors",
  "defineProperty",
  "defineProperties",
  "__lookupGetter__",
  "__lookupSetter__",
  "__defineGetter__",
  "__defineSetter__",
]);
export const NODE_PATH_EXPOSED_GLOBAL_NAMES = new Set([
  "eval",
  "Function",
  "Object",
  "Reflect",
  "String",
  "globalThis",
  "global",
  "window",
  "self",
]);
