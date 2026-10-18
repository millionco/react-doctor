export const MAX_RETURNED_SETTER_EXPRESSIONS = 64;

export const MAX_BODY_ARRAY_MIRROR_TYPE_DEPTH = 32;

export const BODY_ARRAY_MIRROR_UNSUPPORTED_NAMES = new Set([
  "eval",
  "Function",
  "require",
  "module",
  "process",
  "globalThis",
  "window",
]);

export const BODY_ARRAY_MIRROR_REFLECTION_METHODS = new Set([
  "defineProperty",
  "defineProperties",
  "set",
  "setPrototypeOf",
  "getPrototypeOf",
]);

export const BODY_ARRAY_MIRROR_UNSUPPORTED_MODULES = new Set([
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

export const BODY_ARRAY_MIRROR_READONLY_REACT_APIS = new Set(["createRef", "isValidElement"]);
