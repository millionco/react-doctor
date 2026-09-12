import * as path from "node:path";
import { resolveCandidateReadPath } from "./resolve-candidate-read-path.js";

// A path that is already root-relative and normalized (no drive or leading
// slash, no `.` / `..` segments, no empty segment, forward slashes only)
// resolves back to itself, so the resolve/relative round trip is skipped.
// Source listings hand thousands of such paths to the per-file filters.
const NORMALIZED_RELATIVE_PATH_PATTERN =
  /^(?!\.{1,2}(?:\/|$))[^/\\]+(?:\/(?!\.{1,2}(?:\/|$))[^/\\]+)*$/;

export const toNormalizedRelativePath = (filePath: string, rootDirectory: string): string => {
  if (NORMALIZED_RELATIVE_PATH_PATTERN.test(filePath) && !/^[a-zA-Z]:/.test(filePath)) {
    return filePath;
  }
  return (
    path
      .relative(
        path.resolve(rootDirectory),
        path.resolve(resolveCandidateReadPath(rootDirectory, filePath)),
      )
      .replaceAll("\\", "/") || "."
  );
};
