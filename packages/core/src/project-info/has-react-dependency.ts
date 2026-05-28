import type { PackageJson } from "../types/index.js";

const REACT_DEPENDENCY_NAMES = new Set(["react", "react-native", "next", "preact"]);

export const hasReactDependency = (packageJson: PackageJson): boolean => {
  const allDependencies = {
    ...packageJson.peerDependencies,
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };
  return Object.keys(allDependencies).some((packageName) =>
    REACT_DEPENDENCY_NAMES.has(packageName),
  );
};
