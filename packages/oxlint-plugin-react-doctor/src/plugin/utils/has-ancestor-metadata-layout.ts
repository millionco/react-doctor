import * as path from "node:path";
import { CROSS_FILE_DIRECTORY_WALK_MAX_LEVELS } from "../constants/thresholds.js";
import { doesModuleExportName } from "./does-module-export-name.js";

const LAYOUT_FILE_NAMES = ["layout.tsx", "layout.jsx", "layout.ts", "layout.js"];

// Walks up the App Router directory tree from `pageFilename` looking for
// an ancestor `layout.*` that exports `metadata` or `generateMetadata`.
// Next.js metadata is inherited down the route tree, so a layout that
// defines it covers every page below it — those pages already get a
// title and description and must not be flagged. The page's own
// directory IS included (a co-located `layout.tsx` covers `page.tsx`);
// the file being linted is skipped so a layout never matches itself.
// The climb stops at the `app/` root and is bounded so a file outside
// any project can't walk to `/`.
export const hasAncestorMetadataLayout = (pageFilename: string): boolean => {
  const normalizedPage = pageFilename.replaceAll("\\", "/");
  let currentDirectory = path.dirname(normalizedPage);

  for (let level = 0; level < CROSS_FILE_DIRECTORY_WALK_MAX_LEVELS; level++) {
    for (const layoutFileName of LAYOUT_FILE_NAMES) {
      const layoutPath = path.join(currentDirectory, layoutFileName);
      if (layoutPath.replaceAll("\\", "/") === normalizedPage) continue;
      if (
        doesModuleExportName(layoutPath, "metadata") ||
        doesModuleExportName(layoutPath, "generateMetadata")
      ) {
        return true;
      }
    }
    if (path.basename(currentDirectory) === "app") break;
    const parentDirectory = path.dirname(currentDirectory);
    if (parentDirectory === currentDirectory) break;
    currentDirectory = parentDirectory;
  }
  return false;
};
