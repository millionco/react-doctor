import type { PackageJson } from "../../types/index.js";

// Reads a package's declared version spec from any of the four dependency
// sections (runtime → dev → peer → optional), so detection matches the
// framework / RN-workspace gates that also treat `peer`/`optional` entries as
// present. The `typeof` guard keeps a malformed non-string entry (e.g.
// `"expo": 54`) from reaching downstream `.trim()` parsing and aborting the scan.
export const getDependencySpec = (packageJson: PackageJson, packageName: string): string | null => {
  const spec =
    packageJson.dependencies?.[packageName] ??
    packageJson.devDependencies?.[packageName] ??
    packageJson.peerDependencies?.[packageName] ??
    packageJson.optionalDependencies?.[packageName];
  return typeof spec === "string" ? spec : null;
};
