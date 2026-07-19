import { REACT_ROUTER_PACKAGE_NAMES } from "../constants/react-router.js";
import {
  declaresAnyDependency,
  declaresDependency,
  findNearestPackageDirectory,
} from "./classify-package-platform.js";
import { getReactDoctorStringSetting } from "./get-react-doctor-setting.js";
import { isPackageNestedBelowProjectRoot } from "./is-package-nested-below-project-root.js";
import { normalizeFilename } from "./normalize-filename.js";
import { readNearestPackageManifest } from "./read-nearest-package-manifest.js";
import type { RuleContext } from "./rule-context.js";

export const isReactRouterFileActive = (context: RuleContext): boolean => {
  const rawFilename = context.filename;
  if (!rawFilename) return true;
  const filename = normalizeFilename(rawFilename);

  const manifest = readNearestPackageManifest(filename);
  if (!manifest) return true;
  if (REACT_ROUTER_PACKAGE_NAMES.some((packageName) => declaresDependency(manifest, packageName))) {
    return true;
  }
  if (!declaresAnyDependency(manifest)) return true;

  const packageDirectory = findNearestPackageDirectory(filename);
  const rootDirectory = getReactDoctorStringSetting(context.settings, "rootDirectory");
  if (
    packageDirectory !== null &&
    isPackageNestedBelowProjectRoot(packageDirectory, rootDirectory)
  ) {
    return false;
  }
  return true;
};
