import * as path from "node:path";
import { NEXTJS_SOURCE_FILE_EXTENSION_GROUP } from "../constants/nextjs.js";
import { getProjectRelativeFilename } from "./get-project-relative-filename.js";
import { getReactDoctorStringSetting } from "./get-react-doctor-setting.js";
import { isInProjectDirectory } from "./is-in-project-directory.js";
import { isNextjsMetadataImageRouteFilename } from "./is-nextjs-metadata-image-route-filename.js";
import { normalizeFilename } from "./normalize-filename.js";
import { findNearestPackageDirectory } from "./read-nearest-package-manifest.js";
import type { RuleContext } from "./rule-context.js";

const NEXT_APP_ROUTE_FILE_PATTERN = new RegExp(
  `^(page|layout|loading|error|not-found|template|default|global-error|route)\\.${NEXTJS_SOURCE_FILE_EXTENSION_GROUP}$`,
);
const NEXT_PAGES_ROUTE_FILE_PATTERN = new RegExp(
  `^(_app|_document|_error|_meta)\\.${NEXTJS_SOURCE_FILE_EXTENSION_GROUP}$`,
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

const isInNextDirectory = (
  context: Pick<RuleContext, "filename" | "settings">,
  directoryPath: "app" | "pages",
): boolean => {
  if (isInProjectDirectory(context, directoryPath)) return true;
  const filename = normalizeFilename(context.filename ?? "");
  if (path.isAbsolute(filename)) return false;
  return filename.startsWith(`${directoryPath}/`) || filename.includes(`/${directoryPath}/`);
};

const isInExpoRouteDirectory = (context: Pick<RuleContext, "filename" | "settings">): boolean => {
  const filename = normalizeFilename(context.filename ?? "");
  const configuredRootDirectory = getReactDoctorStringSetting(context.settings, "rootDirectory");
  const packageDirectory = path.isAbsolute(filename) ? findNearestPackageDirectory(filename) : null;
  const projectRelativeFilename = getProjectRelativeFilename(
    filename,
    configuredRootDirectory ?? packageDirectory ?? undefined,
  );
  const relativeFilename =
    projectRelativeFilename === filename && path.isAbsolute(filename)
      ? filename.split("/").slice(2).join("/")
      : projectRelativeFilename;
  return relativeFilename.startsWith("app/") || relativeFilename.startsWith("src/app/");
};

export const isFrameworkRouteOrSpecialFilename = (
  context: Pick<RuleContext, "filename" | "settings">,
  runtime: "expo" | "generic" | "next" | "react-router" | "remix" | "tanstack",
): boolean => {
  const rawFilename = context.filename;
  if (!rawFilename) return false;
  const basename = path.basename(rawFilename);
  if (runtime === "next") {
    return (
      (isInNextDirectory(context, "app") &&
        (isNextjsMetadataImageRouteFilename(rawFilename) ||
          NEXT_APP_ROUTE_FILE_PATTERN.test(basename))) ||
      (isInNextDirectory(context, "pages") && NEXT_PAGES_ROUTE_FILE_PATTERN.test(basename))
    );
  }
  if (runtime === "expo") {
    return isInExpoRouteDirectory(context) && EXPO_ROUTE_FILE_PATTERN.test(basename);
  }
  if (runtime === "tanstack") return TANSTACK_ROUTE_FILE_PATTERN.test(basename);
  if (runtime === "react-router" || runtime === "remix") {
    return REACT_ROUTER_FILE_PATTERN.test(basename);
  }
  return false;
};
