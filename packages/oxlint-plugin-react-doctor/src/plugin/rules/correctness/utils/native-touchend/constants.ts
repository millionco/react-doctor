export const NATIVE_TOUCHEND_PARAMETER_COUNT = 1;
export const NATIVE_TOUCHEND_HANDLER_ATTRIBUTE_COUNT = 1;
export const NATIVE_TOUCHEND_FIRST_CHANGED_INDEX = 0;

export const NATIVE_TOUCHEND_COORDINATE_NAMES: ReadonlySet<string> = new Set([
  "clientX",
  "clientY",
]);

export const NATIVE_TOUCHEND_PROVIDER_MODULES: ReadonlySet<string> = new Set([
  "react",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "react-dom",
  "react-dom/client",
]);

export const NATIVE_TOUCHEND_UNSUPPORTED_PROVIDER_PREFIXES: ReadonlyArray<string> = [
  "react-native",
  "preact",
  "expo",
  "solid-js",
];

export const NATIVE_TOUCHEND_UNSUPPORTED_GLOBAL_NAMES: ReadonlySet<string> = new Set([
  "eval",
  "Function",
  "Object",
  "Reflect",
  "require",
  "module",
  "TouchEvent",
  "Event",
  "globalThis",
  "global",
  "window",
  "self",
]);

export const NATIVE_TOUCHEND_UNSUPPORTED_PROPERTY_NAMES: ReadonlySet<string> = new Set([
  "constructor",
  "prototype",
  "__proto__",
  "dispatchEvent",
  "createEvent",
  "initTouchEvent",
  "addEventListener",
  "onTouchEnd",
  "getPrototypeOf",
  "getOwnPropertyDescriptor",
  "getOwnPropertyDescriptors",
  "__lookupGetter__",
  "__lookupSetter__",
  "__defineGetter__",
  "__defineSetter__",
]);

export const NATIVE_TOUCHEND_UNSUPPORTED_PROGRAM_NODE_TYPES: ReadonlySet<string> = new Set([
  "WithStatement",
  "NewExpression",
  "TSDeclareFunction",
  "ImportExpression",
  "TSModuleDeclaration",
  "TSEnumDeclaration",
  "TSImportEqualsDeclaration",
  "TSExportAssignment",
]);

export const NATIVE_TOUCHEND_JSX_PRAGMA_PATTERN = /@jsx(?:\s|Frag|ImportSource|Runtime)/u;
