export const LOCAL_TEXT_MODULE_STATEMENT_COUNT = 3;
export const LOCAL_TEXT_SINGLE_NODE_COUNT = 1;
export const LOCAL_TEXT_MAP_PARAMETER_COUNT = 2;
export const LOCAL_TEXT_EMPTY_NODE_COUNT = 0;
export const LOCAL_TEXT_MAX_SOURCE_CHARACTERS = 16_384;
export const LOCAL_TEXT_MAX_AST_NODES = 200;
export const LOCAL_TEXT_UNSUPPORTED_JSX_DIRECTIVE_PATTERN = /@jsx/iu;
export const LOCAL_TEXT_SUPPORTED_FRAMEWORKS: ReadonlySet<string> = new Set(["vite", "cra"]);
export const LOCAL_TEXT_REQUIRED_CAPABILITIES: ReadonlySet<string> = new Set(["react", "react:17"]);
export const LOCAL_TEXT_UNSUPPORTED_CAPABILITIES: ReadonlySet<string> = new Set([
  "react:18",
  "preact",
  "pure-preact",
  "react-native",
  "expo",
  "react-compiler",
  "r3f",
  "three",
  "remotion",
]);
