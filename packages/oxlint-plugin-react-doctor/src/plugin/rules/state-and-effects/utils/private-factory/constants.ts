export const UNSUPPORTED_FACTORY_RUNTIME_TYPES = new Set([
  "TSEnumDeclaration",
  "TSEnumBody",
  "TSEnumMember",
  "TSModuleDeclaration",
  "TSModuleBlock",
  "TSImportEqualsDeclaration",
  "TSExportAssignment",
  "TSParameterProperty",
  "WithStatement",
]);

export const FACTORY_DYNAMIC_PROVIDER_NAMES = new Set([
  "eval",
  "Function",
  "Reflect",
  "Proxy",
  "globalThis",
  "global",
  "window",
  "self",
]);
export const FACTORY_DYNAMIC_PROVIDER_KEYS = new Set([
  "constructor",
  "__proto__",
  "__defineGetter__",
  "__defineSetter__",
  "eval",
  "Function",
  "Reflect",
  "Proxy",
  "defineProperty",
  "defineProperties",
  "setPrototypeOf",
  "getPrototypeOf",
  "getOwnPropertyDescriptor",
  "getOwnPropertyDescriptors",
  "React",
]);
