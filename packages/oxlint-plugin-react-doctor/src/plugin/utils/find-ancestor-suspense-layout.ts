import { astMentionsSuspense } from "./ast-mentions-suspense.js";
import { hasAncestorLayoutMatching } from "./has-ancestor-layout-matching.js";
import { parseSourceFile } from "./parse-source-file.js";

// True when an ancestor `layout.*` establishes a <Suspense> boundary (the same
// file-level proxy `astMentionsSuspense` uses). A parent layout that wraps
// `{children}` in <Suspense> provides the boundary for the page, so the page's
// own useSearchParams() is already covered and must not be flagged.
export const hasAncestorSuspenseLayout = (pageFilename: string): boolean =>
  hasAncestorLayoutMatching(pageFilename, (layoutPath) => {
    const programRoot = parseSourceFile(layoutPath);
    return Boolean(programRoot && astMentionsSuspense(programRoot));
  });
