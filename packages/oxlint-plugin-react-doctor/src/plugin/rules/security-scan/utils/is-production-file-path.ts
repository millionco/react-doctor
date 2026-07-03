import {
  BUILD_SCRIPT_CONTEXT_PATTERN,
  DOCUMENTATION_CONTEXT_PATTERN,
  GENERATED_SOURCE_CONTEXT_PATTERN,
  TEST_CONTEXT_PATTERN,
} from "../../../constants/security-scan.js";

// Every enabled scan rule re-classifies the same relativePath (once per rule
// per file), so the pure result is memoized. Keyed by BOTH the source-file
// pattern (by object identity — callers pass a small fixed set of module
// constants) and the path, since a path-only key would conflate the source /
// script / database extension variants.
const classificationCacheByPattern = new Map<RegExp, Map<string, boolean>>();

export const isProductionFilePath = (relativePath: string, sourceFilePattern: RegExp): boolean => {
  let classificationByPath = classificationCacheByPattern.get(sourceFilePattern);
  if (!classificationByPath) {
    classificationByPath = new Map();
    classificationCacheByPattern.set(sourceFilePattern, classificationByPath);
  }
  const cached = classificationByPath.get(relativePath);
  if (cached !== undefined) return cached;
  const isProduction =
    sourceFilePattern.test(relativePath) &&
    !TEST_CONTEXT_PATTERN.test(relativePath) &&
    !BUILD_SCRIPT_CONTEXT_PATTERN.test(relativePath) &&
    !DOCUMENTATION_CONTEXT_PATTERN.test(relativePath) &&
    !GENERATED_SOURCE_CONTEXT_PATTERN.test(relativePath);
  classificationByPath.set(relativePath, isProduction);
  return isProduction;
};
