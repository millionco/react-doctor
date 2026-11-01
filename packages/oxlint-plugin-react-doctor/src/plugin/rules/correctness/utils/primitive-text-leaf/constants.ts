export const TEXT_CHUNK_ARGUMENT_COUNT = 1;
export const TEXT_MAP_PARAMETER_COUNT = 2;
export const TEXT_LEAF_ATTRIBUTE_COUNT = 1;
export const TEXT_LEAF_CHILD_COUNT = 1;
export const TEXT_EMPTY_ARRAY_LENGTH = 0;
export const TEXT_REACT_MAJOR_VERSION = 17;
export const TEXT_GLOBAL_CHUNK_PATTERN = /^\.\{1,[1-9]\d*\}$/u;
export const TEXT_JSX_DIRECTIVE_PATTERN = /@jsx(?:ImportSource|Runtime|Frag)?\b/iu;
export const TEXT_UNSUPPORTED_NODE_TYPES: ReadonlySet<string> = new Set([
  "WithStatement",
  "ImportExpression",
  "TSEnumDeclaration",
  "TSModuleDeclaration",
  "TSImportEqualsDeclaration",
  "TSExportAssignment",
  "TSDeclareFunction",
  "TSAsExpression",
  "TSTypeAssertion",
  "TSNonNullExpression",
  "TSSatisfiesExpression",
]);
export const TEXT_UNSUPPORTED_GLOBALS: ReadonlySet<string> = new Set([
  "eval",
  "require",
  "module",
  "process",
  "Function",
  "Reflect",
  "Proxy",
  "globalThis",
  "global",
  "window",
  "self",
  "String",
  "RegExp",
  "Array",
  "Symbol",
  "Object",
]);
export const TEXT_REFLECTION_PROPERTIES: ReadonlySet<string> = new Set([
  "constructor",
  "prototype",
  "__proto__",
]);
export const TEXT_UNSUPPORTED_PROVIDER_MODULES: ReadonlySet<string> = new Set([
  "preact",
  "pure-preact",
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
  "preact/compat",
  "react-native",
  "expo",
]);
export const TEXT_RETAINED_KEY_COUNT = 2;
export const TEXT_STYLED_COMPONENTS_VERSION_PATTERN = /^\^?5(?:\.|$)/u;
