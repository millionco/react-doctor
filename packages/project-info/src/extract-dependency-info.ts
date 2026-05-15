import type { DependencyInfo, PackageJson } from "@react-doctor/types";
import { detectFramework } from "./detect-framework.js";
import { isCatalogReference } from "./resolve-catalog-version.js";

export const EMPTY_DEPENDENCY_INFO: DependencyInfo = {
  reactVersion: null,
  tailwindVersion: null,
  framework: "unknown",
};

export const extractDependencyInfo = (packageJson: PackageJson): DependencyInfo => {
  const allDependencies = {
    ...packageJson.peerDependencies,
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };
  const rawReactVersion = allDependencies.react ?? null;
  const reactVersion =
    rawReactVersion && !isCatalogReference(rawReactVersion) ? rawReactVersion : null;
  const rawTailwindVersion = allDependencies.tailwindcss ?? null;
  const tailwindVersion =
    rawTailwindVersion && !isCatalogReference(rawTailwindVersion) ? rawTailwindVersion : null;
  return {
    reactVersion,
    tailwindVersion,
    framework: detectFramework(allDependencies),
  };
};
