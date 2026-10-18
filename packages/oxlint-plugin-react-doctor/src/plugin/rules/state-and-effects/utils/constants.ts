export const MAX_RETURNED_SETTER_EXPRESSIONS = 64;

export const KEYED_RECORD_RESET_UNSUPPORTED_GLOBAL_NAMES = new Set([
  "eval",
  "Function",
  "Reflect",
  "Proxy",
  "Object",
  "require",
  "module",
  "process",
  "globalThis",
  "window",
]);

export const KEYED_RECORD_RESET_UNSUPPORTED_MODULE_NAMES = new Set([
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

export const KEYED_RECORD_RESET_POSSIBLE_JSX_DIRECTIVE_PATTERN =
  /@jsx(?:ImportSource|Runtime)?(?:\s|$)/;
export const KEYED_RECORD_RESET_JSX_DIRECTIVE_PATTERN =
  /(?:^|\s)@(jsx|jsxImportSource|jsxRuntime)\s+([^\s*]+)/g;

export const KEYED_RECORD_RESET_PRIMITIVE_FIELD_TYPES: ReadonlySet<string> = new Set([
  "TSStringKeyword",
  "TSNumberKeyword",
  "TSBooleanKeyword",
  "TSBigIntKeyword",
  "TSSymbolKeyword",
  "TSNullKeyword",
  "TSUndefinedKeyword",
  "TSNeverKeyword",
  "TSTemplateLiteralType",
]);
