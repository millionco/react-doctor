import { FRAMEWORK_DEPENDENCY_NAMES } from "../constants.js";
import type { Framework, PackageNode } from "../types.js";

const isDeclaredAnywhere = (packages: ReadonlyArray<PackageNode>, name: string): boolean =>
  packages.some((node) => node.dependencies.has(name));

// Derives a single framework label from the whole graph. First match in
// `FRAMEWORK_DEPENDENCY_NAMES` wins; Preact-without-React is the lone special
// case (Preact-on-Vite stays `vite` but still gets Preact rules via the
// `preact` capability, mirroring upstream behavior).
export const deriveFramework = (packages: ReadonlyArray<PackageNode>): Framework => {
  for (const [name, framework] of FRAMEWORK_DEPENDENCY_NAMES) {
    if (isDeclaredAnywhere(packages, name)) return framework;
  }
  if (isDeclaredAnywhere(packages, "preact") && !isDeclaredAnywhere(packages, "react")) {
    return "preact";
  }
  return "unknown";
};
