import * as path from "node:path";
import { CROSS_FILE_DIRECTORY_WALK_MAX_LEVELS } from "../constants/thresholds.js";
import { doesModuleExportName } from "./does-module-export-name.js";

const LAYOUT_FILE_NAMES = ["layout.tsx", "layout.jsx", "layout.ts", "layout.js"];
const METADATA_EXPORT_NAMES = ["metadata", "generateMetadata"];

// Walks up the App Router directory tree from `pageFilename` looking for an
// ancestor `layout.*` that exports `metadata` or `generateMetadata`. Next.js
// merges metadata down the segment chain, so a page inheriting a
// title/description from a parent (or co-located) layout already has
// search-preview metadata and must not be flagged. The page's own directory
// is included (a co-located layout wraps the page); the file being linted is
// skipped so it can't match itself. The climb stops at the `app/` root and is
// bounded so a file outside any project can't walk to `/`.
export const hasAncestorMetadataLayout = (pageFilename: string): boolean => {
  const normalizedPage = pageFilename.replaceAll("\\", "/");
  let currentDirectory = path.dirname(normalizedPage);

  for (let level = 0; level < CROSS_FILE_DIRECTORY_WALK_MAX_LEVELS; level++) {
    for (const layoutFileName of LAYOUT_FILE_NAMES) {
      const layoutPath = path.join(currentDirectory, layoutFileName);
      if (layoutPath.replaceAll("\\", "/") === normalizedPage) continue;
      if (
        METADATA_EXPORT_NAMES.some((exportName) => doesModuleExportName(layoutPath, exportName))
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
