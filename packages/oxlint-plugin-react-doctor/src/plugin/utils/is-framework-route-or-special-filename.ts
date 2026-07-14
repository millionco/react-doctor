import * as path from "node:path";
import { NEXTJS_SOURCE_FILE_EXTENSION_GROUP } from "../constants/nextjs.js";
import { isNextjsMetadataImageRouteFilename } from "./is-nextjs-metadata-image-route-filename.js";

const NEXT_ROUTE_FILE_PATTERN = new RegExp(
  `^(page|layout|loading|error|not-found|template|default|global-error|route|_app|_document|_error|_meta)\\.${NEXTJS_SOURCE_FILE_EXTENSION_GROUP}$`,
);
const EXPO_ROUTE_FILE_PATTERN = new RegExp(
  `^(_layout|\\+html|\\+not-found|\\+native-intent)\\.${NEXTJS_SOURCE_FILE_EXTENSION_GROUP}$`,
);
const TANSTACK_ROUTE_FILE_PATTERN = new RegExp(
  `(?:^__root|\\.lazy)\\.${NEXTJS_SOURCE_FILE_EXTENSION_GROUP}$`,
);
const REACT_ROUTER_FILE_PATTERN = new RegExp(
  `^(root|entry\\.client|entry\\.server)\\.${NEXTJS_SOURCE_FILE_EXTENSION_GROUP}$`,
);

export const isFrameworkRouteOrSpecialFilename = (
  rawFilename: string | undefined,
  runtime: "expo" | "generic" | "next" | "react-router" | "remix" | "tanstack",
): boolean => {
  if (!rawFilename) return false;
  const basename = path.basename(rawFilename);
  if (runtime === "next") {
    return (
      isNextjsMetadataImageRouteFilename(rawFilename) || NEXT_ROUTE_FILE_PATTERN.test(basename)
    );
  }
  if (runtime === "expo") return EXPO_ROUTE_FILE_PATTERN.test(basename);
  if (runtime === "tanstack") return TANSTACK_ROUTE_FILE_PATTERN.test(basename);
  if (runtime === "react-router" || runtime === "remix") {
    return REACT_ROUTER_FILE_PATTERN.test(basename);
  }
  return false;
};
