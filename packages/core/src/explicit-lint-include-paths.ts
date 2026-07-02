import * as fs from "node:fs";
import * as path from "node:path";
import { JSX_FILE_PATTERN, SOURCE_FILE_PATTERN } from "./constants.js";
import type { ProjectInfo } from "./types/index.js";

export const NEXT_ENTRY_FILE_PATTERN =
  /^(?:\.\/)?(?:src\/)?(?:middleware|proxy)\.(?:tsx?|jsx?|mts|mjs)$/;

// Matches a react/preact import (any subpath) or a hook call site. Enough to
// recognize a .ts hook or React utility without parsing.
const REACT_CONTENT_PATTERN =
  /(?:from\s*|require\(\s*|import\(\s*)["'](?:react(?:-dom)?|preact)(?:["']|\/)|\buse[A-Z]\w*\s*\(/;

// Imports sit at the top and hook calls appear early; capping the sniff keeps
// a stray giant asset from being read whole.
const REACT_CONTENT_SNIFF_BYTES = 262_144;

const readFileHead = (absolutePath: string): string | null => {
  try {
    const fileDescriptor = fs.openSync(absolutePath, "r");
    try {
      const buffer = Buffer.alloc(REACT_CONTENT_SNIFF_BYTES);
      const bytesRead = fs.readSync(fileDescriptor, buffer, 0, buffer.length, 0);
      return buffer.toString("utf8", 0, bytesRead);
    } finally {
      fs.closeSync(fileDescriptor);
    }
  } catch {
    return null;
  }
};

const hasReactRelevantContent = (filePath: string, project?: ProjectInfo): boolean => {
  const rootDirectory = project?.rootDirectory;
  if (rootDirectory === undefined) return false;
  const content = readFileHead(path.resolve(rootDirectory, filePath));
  return content !== null && REACT_CONTENT_PATTERN.test(content);
};

// Explicit include paths (--scope files/changed/lines, --staged) always keep
// JSX/TSX files and Next entry files. Other source extensions (.ts, .js, .mts,
// .mjs) are kept only when their content references React (react/preact import
// or a hook call): a full scan flags those files (see #151), and dropping them
// wholesale silently skipped changed .ts hooks and React utilities — but
// including every changed .ts/.js file would fire generic JS rules on
// non-React server and utility code, which is exactly the review noise the
// JSX-only filter existed to prevent.
export const shouldIncludeExplicitLintPath = (filePath: string, project?: ProjectInfo): boolean =>
  JSX_FILE_PATTERN.test(filePath) ||
  (project?.framework === "nextjs" && NEXT_ENTRY_FILE_PATTERN.test(filePath)) ||
  (SOURCE_FILE_PATTERN.test(filePath) && hasReactRelevantContent(filePath, project));

export const computeExplicitLintIncludePaths = (
  includePaths: string[],
  project?: ProjectInfo,
): string[] | undefined =>
  includePaths.length > 0
    ? includePaths.filter((filePath) => shouldIncludeExplicitLintPath(filePath, project))
    : undefined;
