import { METADATA_EXPORT_NAMES } from "../constants/nextjs.js";
import { doesModuleExportName } from "./does-module-export-name.js";
import { hasAncestorLayoutMatching } from "./has-ancestor-layout-matching.js";

// True when the page inherits metadata from a co-located or ancestor
// `layout.*`. Next.js merges metadata down the segment chain, so a page
// covered by a parent layout's title/description already has search-preview
// metadata and must not be flagged.
export const hasAncestorMetadataLayout = (pageFilename: string): boolean =>
  hasAncestorLayoutMatching(pageFilename, (layoutPath) =>
    METADATA_EXPORT_NAMES.some((exportName) => doesModuleExportName(layoutPath, exportName)),
  );
