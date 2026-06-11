import * as path from "node:path";
import { LAYOUT_FILE_NAMES } from "../constants/nextjs.js";
import { CROSS_FILE_DIRECTORY_WALK_MAX_LEVELS } from "../constants/thresholds.js";

// Walks up the App Router directory tree from `pageFilename`, calling
// `matchesLayout` for each candidate ancestor `layout.*`. The page's own
// directory is included (a co-located layout wraps the page); the file being
// linted is skipped so it can't match itself. Returns true on the first match.
// The climb stops at the OUTERMOST `app/` directory — nested `app` segments
// (e.g. the `/app` route at `app/app/page.tsx`) are walked through so the page
// still reaches the real root layout — and is bounded so a file outside any
// project can't walk to `/`.
export const hasAncestorLayoutMatching = (
  pageFilename: string,
  matchesLayout: (layoutPath: string) => boolean,
): boolean => {
  const normalizedPage = pageFilename.replaceAll("\\", "/");
  let currentDirectory = path.dirname(normalizedPage);

  for (let level = 0; level < CROSS_FILE_DIRECTORY_WALK_MAX_LEVELS; level++) {
    for (const layoutFileName of LAYOUT_FILE_NAMES) {
      const layoutPath = path.join(currentDirectory, layoutFileName);
      if (layoutPath.replaceAll("\\", "/") === normalizedPage) continue;
      if (matchesLayout(layoutPath)) return true;
    }
    const parentDirectory = path.dirname(currentDirectory);
    const isOutermostAppDirectory =
      path.basename(currentDirectory) === "app" && path.basename(parentDirectory) !== "app";
    if (isOutermostAppDirectory) break;
    if (parentDirectory === currentDirectory) break;
    currentDirectory = parentDirectory;
  }
  return false;
};
