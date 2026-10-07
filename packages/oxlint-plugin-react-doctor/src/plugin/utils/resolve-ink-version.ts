import { INK_MODULE } from "../constants/ink.js";
import { comparePackageVersions } from "./compare-package-versions.js";
import { parsePackageVersion } from "./parse-package-version.js";
import { resolvePackageVersion } from "./resolve-package-version.js";

export const resolveInkVersion = (filename: string | undefined) =>
  resolvePackageVersion(filename, INK_MODULE)?.version ?? null;

export const isInkVersionAtLeast = (
  filename: string | undefined,
  minimumVersion: string,
): boolean => {
  const resolvedVersion = resolveInkVersion(filename);
  const parsedMinimumVersion = parsePackageVersion(minimumVersion);
  return Boolean(
    resolvedVersion &&
    parsedMinimumVersion &&
    comparePackageVersions(resolvedVersion, parsedMinimumVersion) >= 0,
  );
};
