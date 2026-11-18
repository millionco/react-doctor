import * as path from "node:path";
import { MOTION_LIBRARY_PACKAGES } from "oxlint-plugin-react-doctor/core";
import { isFile, readPackageJson } from "../project-info/index.js";

export const hasMotionLibraryDependency = (rootDirectory: string): boolean => {
  const packageJsonPath = path.join(rootDirectory, "package.json");
  if (!isFile(packageJsonPath)) return false;
  try {
    const packageJson = readPackageJson(packageJsonPath);
    const allDependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
    return Object.keys(allDependencies).some((packageName) =>
      MOTION_LIBRARY_PACKAGES.has(packageName),
    );
  } catch {
    return false;
  }
};
