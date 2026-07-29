export const NODE_PACK_TARGET = "node20";
export const DEFAULT_TEST_TIMEOUT_MS = 30_000;

const OXC_RUNTIME_EXTERNALS: ReadonlyArray<string> = [
  "oxc-parser",
  "oxc-resolver",
  "oxlint",
  "oxlint-plugin-react-doctor",
];

export const ENGINE_RUNTIME_EXTERNALS: ReadonlyArray<string> = [
  "deslop-js",
  "effect",
  ...OXC_RUNTIME_EXTERNALS,
  "typescript",
];

export const NATIVE_ANALYZER_RUNTIME_EXTERNALS: ReadonlyArray<string> = [
  "deslop-js",
  ...OXC_RUNTIME_EXTERNALS,
];

export const NATIVE_ANALYZER_EXTERNALS: ReadonlyArray<string> = [
  ...NATIVE_ANALYZER_RUNTIME_EXTERNALS,
  "typescript",
];

export const LSP_RUNTIME_EXTERNALS: ReadonlyArray<string> = [
  "vscode-languageserver",
  "vscode-languageserver-protocol",
  "vscode-languageserver-textdocument",
  "vscode-jsonrpc",
  "vscode-uri",
];
