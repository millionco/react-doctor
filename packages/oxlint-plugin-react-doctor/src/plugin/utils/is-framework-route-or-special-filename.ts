import * as path from "node:path";
import { NEXTJS_SOURCE_FILE_EXTENSION_GROUP } from "../constants/nextjs.js";
import { isNextjsMetadataImageRouteFilename } from "./is-nextjs-metadata-image-route-filename.js";

// Route / special files from the React frameworks with file-based
// routing. Each framework's bundler plugin owns HMR for these modules,
// and by contract they co-export route config / metadata / data
// functions next to the default component — so those non-component
// exports are the documented shape, not a Fast Refresh hazard. Matched
// by basename (the same JS/TS module extensions Next.js resolves) so a
// deep route path resolves the same as a shallow one.
const sourceFileExtensionGroup = NEXTJS_SOURCE_FILE_EXTENSION_GROUP;

const FRAMEWORK_ROUTE_FILE_PATTERNS: ReadonlyArray<RegExp> = [
  // Next.js App Router + Pages Router special files. (Metadata image
  // routes — opengraph-image, icon, … — are matched separately below.)
  new RegExp(
    `^(page|layout|loading|error|not-found|template|default|global-error|route|_app|_document|_error)\\.${sourceFileExtensionGroup}$`,
  ),
  // Expo Router: `_layout` segment wrapper + `+`-prefixed reserved files.
  new RegExp(`^(_layout|\\+html|\\+not-found|\\+native-intent)\\.${sourceFileExtensionGroup}$`),
  // TanStack Router / Start: `__root` root route + `*.lazy` split routes.
  new RegExp(`(?:^__root|\\.lazy)\\.${sourceFileExtensionGroup}$`),
  // Remix / React Router: `root` route module + client/server entries.
  new RegExp(`^(root|entry\\.client|entry\\.server)\\.${sourceFileExtensionGroup}$`),
];

export const isFrameworkRouteOrSpecialFilename = (rawFilename: string | undefined): boolean => {
  if (!rawFilename) return false;
  if (isNextjsMetadataImageRouteFilename(rawFilename)) return true;
  const basename = path.basename(rawFilename);
  return FRAMEWORK_ROUTE_FILE_PATTERNS.some((pattern) => pattern.test(basename));
};
