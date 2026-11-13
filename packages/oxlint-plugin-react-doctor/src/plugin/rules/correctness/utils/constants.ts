export const NATIVE_SUBMIT_HELPER_ARGUMENT_COUNT = 0;
export const NATIVE_SUBMIT_HANDLER_PARAMETER_COUNT = 1;
export const NATIVE_SUBMIT_ATTRIBUTE_COUNT = 1;

export const NATIVE_SUBMIT_PROVIDER_MODULES: ReadonlySet<string> = new Set([
  "react",
  "react-router",
  "react-router-dom",
]);

export const NATIVE_SUBMIT_UNSUPPORTED_GLOBALS: ReadonlySet<string> = new Set([
  "eval",
  "Function",
  "require",
  "globalThis",
  "global",
  "window",
  "self",
  "arguments",
]);

export const NATIVE_SUBMIT_RUNTIME_TYPESCRIPT_NODES: ReadonlySet<string> = new Set([
  "TSModuleDeclaration",
  "TSEnumDeclaration",
  "TSImportEqualsDeclaration",
  "TSExportAssignment",
]);

export const NATIVE_SUBMIT_MODULE_ARGUMENT_COUNT = 1;
