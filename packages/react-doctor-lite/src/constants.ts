import type { Framework } from "./types.js";

// Below this file count the worker-pool overhead (thread spawn + message
// serialization) outweighs the parallelism win, so we lint in-process.
export const WORKER_POOL_MIN_FILES = 24;

// Files handed to a single worker task when the caller does not override it.
export const DEFAULT_BATCH_SIZE_FILES = 32;

// Directories never worth walking when listing source files on disk.
export const IGNORED_DIRECTORY_NAMES: ReadonlySet<string> = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  ".git",
  ".next",
  ".turbo",
  ".cache",
  ".vercel",
]);

// Extensions the engine parses as source.
export const SOURCE_FILE_PATTERN = /\.(?:tsx?|jsx?|mjs|cjs)$/;

// The lowest React major the rule registry gates on (`react:17` … `react:N`).
export const MIN_GATED_REACT_MAJOR = 17;

export const TANSTACK_QUERY_DEPENDENCY_NAMES: ReadonlySet<string> = new Set([
  "@tanstack/react-query",
  "@tanstack/query-core",
  "react-query",
]);

export const REACT_COMPILER_DEPENDENCY_NAMES: ReadonlySet<string> = new Set([
  "babel-plugin-react-compiler",
  "react-compiler-runtime",
  "eslint-plugin-react-compiler",
]);

// Package name -> framework, evaluated in declaration order (first match wins).
export const FRAMEWORK_DEPENDENCY_NAMES: ReadonlyArray<readonly [string, Framework]> = [
  ["next", "nextjs"],
  ["@tanstack/react-start", "tanstack-start"],
  ["@remix-run/react", "remix"],
  ["react-scripts", "cra"],
  ["gatsby", "gatsby"],
  ["expo", "expo"],
  ["react-native", "react-native"],
  ["vite", "vite"],
];
