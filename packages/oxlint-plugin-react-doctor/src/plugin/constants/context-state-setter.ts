import {
  REACT_JSX_PROVIDER_MODULE_SOURCES,
  IMPORTED_CLASS_REFUSED_MEMBER_NAMES,
  IMPORTED_CLASS_REFUSED_MODULE_SOURCES,
} from "./react.js";

export const CONTEXT_SETTER_PUBLIC_MANIFEST_FIELDS = [
  "exports",
  "main",
  "module",
  "source",
  "bin",
  "browser",
  "types",
  "typings",
  "react-native",
  "overrides",
  "resolutions",
  "pnpm",
  "babel",
  "vite",
];

export const CONTEXT_SETTER_PASSIVE_ASSET_PATTERN =
  /\.(?:json|css|scss|sass|less|svg|png|jpe?g|gif|ico|webp|avif|woff2?|ttf|otf)$/i;

export const CONTEXT_SETTER_HTML_SCRIPT_START_PATTERN = /<script\b/gi;

export const CONTEXT_SETTER_HTML_SCRIPT_PATTERN =
  /<script\s+(?:type\s*=\s*["']module["']\s+src\s*=\s*["'](?<typeFirstSource>[^"'<>]+)["']|src\s*=\s*["'](?<sourceFirstSource>[^"'<>]+)["']\s+type\s*=\s*["']module["'])\s*>\s*<\/script\s*>/gi;

export const CONTEXT_SETTER_HTML_FORBIDDEN_PATTERN =
  /\bon[a-z]+\s*=|javascript\s*:|\bsrcdoc\s*=|<(?:iframe|object|embed)\b/i;

export const CONTEXT_SETTER_REACT_NAMESPACE_CALLS = new Set([
  "createContext",
  "useContext",
  "useState",
  "useCallback",
  "useMemo",
]);

export const CONTEXT_SETTER_CANONICAL_MODULE_SOURCES = [
  ...REACT_JSX_PROVIDER_MODULE_SOURCES,
  "react-dom",
  "react-dom/client",
  "@mui/material",
  "@mui/material/styles",
];

export const CONTEXT_SETTER_REFUSED_GLOBAL_NAMES = [
  "require",
  "eval",
  "Function",
  "Reflect",
  "Proxy",
  "Worker",
  "SharedWorker",
  "importScripts",
  "arguments",
  "process",
  "module",
];

export const CONTEXT_SETTER_REFUSED_MODULE_SOURCES = new Set([
  ...IMPORTED_CLASS_REFUSED_MODULE_SOURCES,
  "worker_threads",
  "node:worker_threads",
]);

export const CONTEXT_SETTER_REFUSED_MEMBER_NAMES = new Set([
  ...IMPORTED_CLASS_REFUSED_MEMBER_NAMES,
  "eval",
  "Function",
  "glob",
  "globEager",
  "createRequire",
  "importScripts",
  "cloneElement",
]);

export const CONTEXT_SETTER_PASSIVE_OBJECT_METHOD_NAMES = new Set([
  "keys",
  "values",
  "entries",
  "hasOwn",
]);

export const CONTEXT_SETTER_DECLARED_PACKAGE_VERSION_PATTERN = /^[~^]?\d/;

export const CONTEXT_SETTER_VITE_CONFIG_NAMES = [
  "vite.config.ts",
  "vite.config.js",
  "vite.config.mjs",
  "vite.config.mts",
  "vite.config.cjs",
  "vite.config.cts",
];

export const CONTEXT_SETTER_VITE_PLUGIN_SOURCES = [
  "@vitejs/plugin-react",
  "vite-tsconfig-paths",
  "vite-plugin-svgr",
  "vite-plugin-pwa",
];

export const CONTEXT_SETTER_VITE_COMMAND_PATTERN = /^vite(?: (?:build|preview))?$/;

export const CONTEXT_SETTER_VITE_SCRIPT_NAME_PATTERN = /^(?:pre|post)?(?:dev|build|preview|start)$/;
