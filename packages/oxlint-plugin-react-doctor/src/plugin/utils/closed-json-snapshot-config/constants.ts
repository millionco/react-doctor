export const SNAPSHOT_CONFIG_MAX_FILES = 16;
export const SNAPSHOT_CONFIG_MAX_DEPTH = 16;
export const SNAPSHOT_CONFIG_MAX_NODES = 8192;
export const SNAPSHOT_CONFIG_MAX_BYTES = 262144;
export const SNAPSHOT_CONFIG_SUPPORTED_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".mjs",
  ".json",
  ".css",
  ".less",
]);
export { SNAPSHOT_BOOTSTRAP_SOURCES as SNAPSHOT_BOOTSTRAP_PREFIX_SOURCES } from "../closed-json-snapshot-bootstrap/constants.js";
export const SNAPSHOT_BOOTSTRAP_PACKAGE_NAMES = new Set([
  "babel-polyfill",
  "console-polyfill",
  "raf",
  "performance-now",
  "core-js",
  "regenerator-runtime",
  "babel-runtime",
]);
export const SNAPSHOT_WEBPACK_RUNTIME_NAMES = new Set([
  "webpackJsonp",
  "__webpack_require__",
  "__webpack_exports__",
  "__webpack_public_path__",
  "__webpack_modules__",
  "__webpack_chunk_load__",
  "__non_webpack_require__",
  "__webpack_nonce__",
  "requirejs",
  "define",
  "System",
  "exports",
  "arguments",
]);
export const SNAPSHOT_WEBPACK_MODULE_ARGUMENT_NAMES = new Set([
  "__webpack_require__",
  "__webpack_exports__",
]);
export const SNAPSHOT_KNOWN_SDK_REQUEST_HEADS = [
  "react",
  "react-dom",
  "axios",
  "react-router-dom",
  "react-router",
  "lodash",
  "antd",
  "object-assign",
  "history",
  "scheduler",
  "prop-types",
  "loose-envify",
  "react-is",
  "js-tokens",
  "invariant",
  "warning",
  "hoist-non-react-statics",
  "path-to-regexp",
  "resolve-pathname",
  "value-equal",
  "tiny-invariant",
  "tiny-warning",
  "mini-create-react-context",
  "@babel/runtime",
  "babel-runtime",
  "is-buffer",
];
