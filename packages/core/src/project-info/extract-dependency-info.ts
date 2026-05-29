import type { DependencyInfo, PackageJson } from "../types/index.js";
import { detectFramework } from "./detect-framework.js";
import { isConcreteDependencyVersion } from "./utils/dependency-version-spec.js";
import { isCatalogReference } from "./resolve-catalog-version.js";

export const EMPTY_DEPENDENCY_INFO: DependencyInfo = {
  reactVersion: null,
  tailwindVersion: null,
  zodVersion: null,
  framework: "unknown",
};

const pickConcreteVersion = (
  packageJson: PackageJson,
  packageName: string,
  sections: ReadonlyArray<"dependencies" | "peerDependencies" | "devDependencies">,
): string | null => {
  for (const section of sections) {
    const version = packageJson[section]?.[packageName];
    if (version === undefined) continue;
    if (isCatalogReference(version)) return null;
    if (isConcreteDependencyVersion(version)) return version;
  }
  return null;
};

export const extractDependencyInfo = (packageJson: PackageJson): DependencyInfo => {
  const allDependencies = {
    ...packageJson.peerDependencies,
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };
  const reactVersion = pickConcreteVersion(packageJson, "react", [
    "dependencies",
    "peerDependencies",
    "devDependencies",
  ]);
  const tailwindVersion = pickConcreteVersion(packageJson, "tailwindcss", [
    "dependencies",
    "devDependencies",
    "peerDependencies",
  ]);
  const zodVersion = pickConcreteVersion(packageJson, "zod", [
    "dependencies",
    "devDependencies",
    "peerDependencies",
  ]);
  return {
    reactVersion,
    tailwindVersion,
    zodVersion,
    framework: detectFramework(allDependencies),
  };
};
