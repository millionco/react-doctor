import type { DependencyInfo, PackageJson } from "../../types/project-info.js";
import { collectAllDependencies } from "./collect-all-dependencies.js";
import { detectFramework } from "./detect-framework.js";
import { isCatalogReference } from "./resolve-catalog-version.js";

export const EMPTY_DEPENDENCY_INFO: DependencyInfo = {
  reactVersion: null,
  tailwindVersion: null,
  framework: "unknown",
};

export const extractDependencyInfo = (packageJson: PackageJson): DependencyInfo => {
  const allDependencies = collectAllDependencies(packageJson);
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
