export const QUOTED_PROJECT_NAME_FORWARDING_HOPS = 2;
export const QUOTED_PROJECT_NAME_CAPTURE_INDEX = 1;
export const QUOTED_PROJECT_NAME_CAPABILITIES: ReadonlySet<string> = new Set([
  "eval",
  "Function",
  "Object",
  "Symbol",
  "arguments",
  "Reflect",
  "Proxy",
  "global",
  "globalThis",
  "window",
  "self",
]);
export const QUOTED_PROJECT_NAME_DANGEROUS_MEMBERS: ReadonlySet<string> = new Set([
  "prototype",
  "__proto__",
  "constructor",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
  "mainModule",
  "defineProperty",
  "defineProperties",
  "setPrototypeOf",
]);
export const QUOTED_PROJECT_NAME_RUNTIME_TYPESCRIPT: ReadonlySet<string> = new Set([
  "TSEnumDeclaration",
  "TSModuleDeclaration",
  "TSParameterProperty",
  "TSImportEqualsDeclaration",
  "TSExportAssignment",
]);
export const QUOTED_PROJECT_NAME_CAPTURE_PATTERNS: ReadonlySet<string> = new Set([
  "rootProject.name\\s+=\\s+['\"](.*)['\"]",
  "rootProject\\.name\\s+=\\s+['\"](.*)['\"]",
]);
export const QUOTED_PROJECT_NAME_OPTION_FIELDS: ReadonlySet<string> = new Set([
  "files",
  "countMatches",
  "allowEmptyPaths",
]);
export const QUOTED_PROJECT_NAME_PATH_SOURCES: ReadonlySet<string> = new Set(["path", "node:path"]);
export const QUOTED_PROJECT_NAME_FS_SOURCES: ReadonlySet<string> = new Set(["fs", "node:fs"]);
export const QUOTED_PROJECT_NAME_REPLACEMENT_SOURCES: ReadonlySet<string> = new Set([
  "replace-in-file",
]);
export const QUOTED_PROJECT_NAME_CAPABILITY_MODULES: ReadonlySet<string> = new Set([
  "fs",
  "path",
  "module",
  "vm",
  "process",
  "child_process",
  "worker_threads",
  "inspector",
  "inspector/promises",
  "replace-in-file",
]);

export const QUOTED_PROJECT_NAME_PROCESS_MEMBERS: ReadonlySet<string> = new Set([
  "env",
  "cwd",
  "platform",
  "argv",
  "exit",
]);
