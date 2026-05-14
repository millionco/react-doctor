import type { PackageJson } from "../../types/project-info.js";
import { collectAllDependencies } from "./collect-all-dependencies.js";

const REACT_DEPENDENCY_NAMES = new Set(["react", "react-native", "next"]);

export const hasReactDependency = (packageJson: PackageJson): boolean => {
  const allDependencies = collectAllDependencies(packageJson);
  return Object.keys(allDependencies).some((packageName) =>
    REACT_DEPENDENCY_NAMES.has(packageName),
  );
};
