import type { ParsedPackageVersion } from "./parse-package-version.js";

export const comparePackageVersions = (
  leftVersion: ParsedPackageVersion,
  rightVersion: ParsedPackageVersion,
): number =>
  leftVersion.major - rightVersion.major ||
  leftVersion.minor - rightVersion.minor ||
  leftVersion.patch - rightVersion.patch ||
  Number(rightVersion.isPrerelease) - Number(leftVersion.isPrerelease);
