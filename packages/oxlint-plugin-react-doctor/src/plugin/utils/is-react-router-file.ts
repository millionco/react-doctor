import { REACT_ROUTER_PACKAGE_NAMES } from "../constants/react-router.js";
import {
  declaresAnyDependency,
  declaresDependency,
  findNearestPackageDirectory,
} from "./classify-package-platform.js";
import { getReactDoctorStringSetting } from "./get-react-doctor-setting.js";
import { isPackageWithinProjectRoot } from "./is-package-within-project-root.js";
import { normalizeFilename } from "./normalize-filename.js";
import { readNearestPackageManifest } from "./read-nearest-package-manifest.js";
import type { RuleContext } from "./rule-context.js";

interface ReactRouterFileActivationOptions {
  requiresFramework?: boolean;
}

export const isReactRouterFileActive = (
  context: RuleContext,
  options: ReactRouterFileActivationOptions = {},
): boolean => {
  const rawFilename = context.filename;
  if (!rawFilename) return true;
  const filename = normalizeFilename(rawFilename);

  const manifest = readNearestPackageManifest(filename);
  if (!manifest) return true;
  const packageDirectory = findNearestPackageDirectory(filename);
  const rootDirectory = getReactDoctorStringSetting(context.settings, "rootDirectory");
  const isProjectPackage =
    packageDirectory !== null && isPackageWithinProjectRoot(packageDirectory, rootDirectory, true);
  if (options.requiresFramework && isProjectPackage && declaresAnyDependency(manifest)) {
    return declaresDependency(manifest, "@react-router/dev");
  }
  if (REACT_ROUTER_PACKAGE_NAMES.some((packageName) => declaresDependency(manifest, packageName))) {
    return true;
  }
  if (!declaresAnyDependency(manifest)) return true;

  if (
    packageDirectory !== null &&
    isPackageWithinProjectRoot(packageDirectory, rootDirectory, false)
  )
    return false;
  return true;
};
