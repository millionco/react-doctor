import type { PackageJson } from "@react-doctor/types";

const REACT_DEPENDENCY_NAMES = new Set(["react", "react-native", "next"]);

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
