import * as path from "node:path";
import { CROSS_FILE_DIRECTORY_WALK_MAX_LEVELS } from "../constants/thresholds.js";
import { astMentionsSuspense } from "./ast-mentions-suspense.js";
import { parseSourceFile } from "./parse-source-file.js";

const LAYOUT_FILE_NAMES = ["layout.tsx", "layout.jsx", "layout.ts", "layout.js"];

// Walks up the App Router directory tree from `pageFilename` looking for
// an ancestor `layout.*` that establishes a <Suspense> boundary (the
// same file-level proxy `astMentionsSuspense` uses). A parent layout
// that wraps `{children}` in <Suspense> provides the boundary for the
// page, so the page's own useSearchParams() is already covered and must
// not be flagged. The page's own directory IS included (a co-located
// `layout.tsx` wraps `page.tsx`); the file being linted is skipped so a
// layout never matches itself. The climb stops at the `app/` root and
// is bounded so a file outside any project can't walk to `/`.
export const hasAncestorSuspenseLayout = (pageFilename: string): boolean => {
  const normalizedPage = pageFilename.replaceAll("\\", "/");
  let currentDirectory = path.dirname(normalizedPage);

  for (let level = 0; level < CROSS_FILE_DIRECTORY_WALK_MAX_LEVELS; level++) {
    for (const layoutFileName of LAYOUT_FILE_NAMES) {
      const layoutPath = path.join(currentDirectory, layoutFileName);
      if (layoutPath.replaceAll("\\", "/") === normalizedPage) continue;
      const programRoot = parseSourceFile(layoutPath);
      if (programRoot && astMentionsSuspense(programRoot)) return true;
    }
    if (path.basename(currentDirectory) === "app") break;
    const parentDirectory = path.dirname(currentDirectory);
    if (parentDirectory === currentDirectory) break;
    currentDirectory = parentDirectory;
  }
  return false;
};
