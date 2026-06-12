import type { DiagnosticFileContext } from "./types/index.js";
import { isTestFilePath } from "./is-test-file.js";

const STORY_FILE_SUFFIX_PATTERN = /\.(?:stories|story)\.(?:[cm]?[jt]sx?)$/;

/**
 * Classifies where a file sits relative to shipped code. A finding in a
 * `.stories.tsx` or `.spec.ts` file never runs in front of users, so
 * renderers label those sites instead of framing them as production
 * impact (`rn-no-raw-text` in a spec doesn't say users crash).
 *
 * `"story"` is the `.stories.*` / `.story.*` suffix; `"test"` is
 * everything else `isTestFilePath` matches (test/spec/fixture suffixes
 * and test directories); `"production"` is the default.
 */
export const classifyFileContext = (relativePath: string): DiagnosticFileContext => {
  if (relativePath.length === 0) return "production";
  const forwardSlashed = relativePath.replaceAll("\\", "/");
  if (STORY_FILE_SUFFIX_PATTERN.test(forwardSlashed)) return "story";
  return isTestFilePath(forwardSlashed) ? "test" : "production";
};
