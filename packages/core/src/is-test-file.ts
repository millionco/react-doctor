import { classifyFileContext } from "./classify-file-context.js";

// Derived from `classifyFileContext` so the test/story path heuristics
// live in exactly one place: any non-production context (a story file
// is still non-shipping code) counts as a test path for test-noise
// auto-suppression.
export const isTestFilePath = (relativePath: string): boolean =>
  classifyFileContext(relativePath) !== "production";
