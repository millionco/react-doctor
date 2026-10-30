export const OBSERVER_COMPONENT_ARGUMENT_COUNT = 1;
export const OBSERVER_MODULE_SOURCE = "mobx-react-lite";
export const OBSERVER_UNSUPPORTED_GLOBAL_REFERENCE_NAMES = new Set([
  "Function",
  "module",
  "require",
  "globalThis",
  "window",
  "self",
  "global",
]);

export const CSF2_SINGLE_ROLE_COUNT = 1;

export const CSF2_BIND_ARGUMENT_COUNT = 1;

export const CSF2_UNSUPPORTED_GLOBAL_NAMES = new Set([
  "eval",
  "Function",
  "Reflect",
  "globalThis",
  "global",
  "window",
  "self",
  "require",
  "module",
]);

export const CSF2_UNSUPPORTED_TYPESCRIPT_NODES = new Set([
  "TSModuleDeclaration",
  "TSEnumDeclaration",
  "TSImportEqualsDeclaration",
  "TSExportAssignment",
]);

export const CSF2_FORBIDDEN_PROPERTY_NAMES = new Set([
  "prototype",
  "__proto__",
  "constructor",
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
  "defaultView",
  "contentWindow",
  "Function",
  "Reflect",
  "globalThis",
  "global",
  "window",
  "self",
  "eval",
]);

export const CSF2_REACT_PROVIDER_MODULES = new Set([
  "react",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
]);

export const CSF2_JSX_PRAGMA_PATTERN = /@jsx(?:\s|Frag|ImportSource|Runtime)/u;
