import type { PackageJson } from "../types/index.js";

const PREACT_PACKAGES = new Set(["preact"]);

// Preact bindings the user might add alongside `preact` itself —
// presence of these alone (without `preact`) still signals a Preact
// codebase to the rule gate. `@preact/signals` etc. live in their own
// packages but always require `preact` as a peer, so we don't need to
// list them here to keep the rule activation correct.
export const hasPreact = (packageJson: PackageJson): boolean => {
  const allDependencies = {
    ...packageJson.peerDependencies,
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };
  return Object.keys(allDependencies).some((packageName) => PREACT_PACKAGES.has(packageName));
};
