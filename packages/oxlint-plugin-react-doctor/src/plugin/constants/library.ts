export const HEAVY_LIBRARIES = new Set([
  "@monaco-editor/react",
  "monaco-editor",
  "recharts",
  "@react-pdf/renderer",
  "react-quill",
  "@codemirror/view",
  "@codemirror/state",
  "chart.js",
  "react-chartjs-2",
  "@toast-ui/editor",
  "draft-js",
  "mermaid",
]);

export const FETCH_CALLEE_NAMES = new Set(["fetch", "ky", "got", "wretch", "ofetch"]);
export const FETCH_MEMBER_OBJECTS = new Set(["axios", "ky", "got", "ofetch", "wretch", "request"]);

export const MUTATION_METHOD_NAMES = new Set([
  "create",
  "insert",
  "insertInto",
  "update",
  "upsert",
  "delete",
  "remove",
  "destroy",
  "set",
  "append",
]);

export const MUTATING_HTTP_METHODS = new Set(["POST", "PUT", "DELETE", "PATCH"]);

export const SAFE_MUTABLE_CONSTRUCTOR_NAMES = new Set([
  "Map",
  "Set",
  "WeakMap",
  "WeakSet",
  "Headers",
  "URLSearchParams",
  "FormData",
  "Response",
  "NextResponse",
]);

export const RESPONSE_FACTORY_OBJECTS = new Set(["Response", "NextResponse"]);
export const RESPONSE_FACTORY_METHODS = new Set(["json", "redirect", "next", "rewrite", "error"]);

// Dedicated keyboard-shortcut libraries, keyed by import source. When a
// file that hand-rolls a `keydown`/`keyup` listener already imports one
// of these, `prefer-keybind-library` points at the library the project
// already uses instead of defaulting to the recommendation below. The
// display value is what the diagnostic names back to the user.
export const KEYBIND_LIBRARY_BY_IMPORT_SOURCE = new Map<string, string>([
  ["react-hotkeys-hook", "react-hotkeys-hook"],
  ["react-hotkeys", "react-hotkeys"],
  ["@mantine/hooks", "@mantine/hooks"],
  ["hotkeys-js", "hotkeys-js"],
  ["mousetrap", "mousetrap"],
  ["tinykeys", "tinykeys"],
  ["@github/hotkey", "@github/hotkey"],
]);

// The library suggested when the file doesn't already import a keybind
// library — the most widely used React option.
export const DEFAULT_KEYBIND_LIBRARY = "react-hotkeys-hook";
