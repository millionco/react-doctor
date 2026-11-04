export const CLOSED_CLASS_MERGER_ALTERNATIVE_LIMIT = 64;
export const CLOSED_CLASS_MERGER_EXPRESSION_LIMIT = 256;
export const CLOSED_CLASS_MERGER_STRING_LENGTH_LIMIT = 32768;
export const CLOSED_CLASS_MERGER_RESOLUTION_LIMIT = 16;
export const CLOSED_CLASS_MERGER_CONFIG_NODE_LIMIT = 1024;
export const CLOSED_CLASS_MERGER_PACKAGE_SELECTOR_PATTERN =
  /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
export const CLOSED_CLASS_MERGER_CONFIG_NAMES = [
  "vite.config.ts",
  "vite.config.mts",
  "vite.config.cts",
  "vite.config.js",
  "vite.config.mjs",
  "vite.config.cjs",
  "webpack.config.ts",
  "webpack.config.mts",
  "webpack.config.cts",
  "webpack.config.js",
  "webpack.config.mjs",
  "webpack.config.cjs",
];
export const CLOSED_CLASS_MERGER_CONFIG_IMPORTS: ReadonlySet<string> = new Set([
  "vite",
  "path",
  "node:path",
  "@vitejs/plugin-react",
  "@tailwindcss/vite",
]);
export const CLOSED_CLASS_MERGER_VITE_PLUGINS: ReadonlySet<string> = new Set([
  "@vitejs/plugin-react",
  "@tailwindcss/vite",
]);
export const CLOSED_CLASS_MERGER_CONFIG_PROVIDER_MAJORS: ReadonlyMap<string, number> = new Map([
  ["vite", 7],
  ["@vitejs/plugin-react", 5],
  ["@tailwindcss/vite", 4],
]);
export const CLOSED_CLASS_MERGER_VERSIONS: ReadonlyMap<string, string> = new Map([
  ["tailwind-merge", "3.4.0"],
  ["clsx", "2.1.1"],
]);
export const CLOSED_CLASS_MERGER_PACKAGES: ReadonlySet<string> = new Set(
  CLOSED_CLASS_MERGER_VERSIONS.keys(),
);
export const CLOSED_CLASS_MERGER_INTRINSIC_NAMES: ReadonlySet<string> = new Set([
  "Array",
  "Map",
  "Number",
  "Object",
  "RegExp",
  "String",
]);
export const CLOSED_CLASS_MERGER_CAPABILITY_NAMES: ReadonlySet<string> = new Set([
  ...CLOSED_CLASS_MERGER_INTRINSIC_NAMES,
  "Reflect",
  "Function",
  "eval",
  "globalThis",
  "window",
  "self",
  "global",
]);
