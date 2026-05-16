import {
  TEST_LIBRARY_IMPORT_SOURCES,
  TEST_LIBRARY_IMPORT_SOURCE_PREFIXES,
} from "../constants/js.js";

// Returns true when an `import ... from "<source>"` (or
// `require("<source>")`) module identifier belongs to a known test
// runner, browser-test harness, assertion library, or interaction
// driver. Used to suppress noisy "this should be parallelized" advice
// in fixtures that import these libraries but don't match the shared
// `isTestFilePath` path heuristic (e.g. `src/test-utils.ts`,
// component fixtures co-located with production code).
export const isTestLibraryImportSource = (source: unknown): boolean => {
  if (typeof source !== "string" || source.length === 0) return false;
  if (TEST_LIBRARY_IMPORT_SOURCES.has(source)) return true;
  return TEST_LIBRARY_IMPORT_SOURCE_PREFIXES.some((prefix) => source.startsWith(prefix));
};
