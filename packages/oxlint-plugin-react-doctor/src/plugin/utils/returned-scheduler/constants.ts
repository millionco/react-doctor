export const GLOBAL_OBJECT_NAMES = new Set(["window", "self", "globalThis", "Object"]);
export const DYNAMIC_CODE_NAMES = new Set(["eval", "Function"]);
export const PROVIDER_CAPABILITY_NAMES = new Set([
  "eval",
  "Function",
  "constructor",
  "__defineGetter__",
  "__defineSetter__",
  "getPrototypeOf",
  "getOwnPropertyDescriptor",
  "getOwnPropertyDescriptors",
]);
export const TIMER_NAMES = new Set(["setTimeout", "clearTimeout"]);
export const RUNTIME_PROVIDER_NODES = new Set([
  "WithStatement",
  "ImportExpression",
  "TSEnumDeclaration",
  "TSEnumBody",
  "TSEnumMember",
  "TSModuleDeclaration",
  "TSModuleBlock",
  "TSImportEqualsDeclaration",
  "TSExportAssignment",
  "TSParameterProperty",
  "Decorator",
]);

export const SCHEDULER_PROVIDER_NAMES = new Set([...GLOBAL_OBJECT_NAMES, ...TIMER_NAMES]);
