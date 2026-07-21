import browserslist from "browserslist";
import * as semver from "semver";
import {
  ELECTRON_EXPLICIT_NOOPENER_MIN_VERSION,
  ELECTRON_IMPLICIT_NOOPENER_MIN_VERSION,
  TARGET_BLANK_BROWSER_SUPPORT,
} from "../constants.js";
import type { PackageJson } from "../types/index.js";
import { getDependencySpec } from "./dependencies.js";
import { normalizeDependencyVersion } from "./version.js";

const getLowestBrowserVersion = (version: string): ReadonlyArray<number> | null => {
  const lowerBound = version.split("-")[0];
  const segments = lowerBound.split(".");
  if (segments.length === 0 || segments.some((segment) => !/^\d+$/.test(segment))) return null;
  return segments.map((segment) => Number.parseInt(segment, 10));
};

export const isBrowserVersionAtLeast = (version: string, minimumVersion: number): boolean => {
  const versionSegments = getLowestBrowserVersion(version);
  if (versionSegments === null) return false;
  const minimumSegments = String(minimumVersion)
    .split(".")
    .map((segment) => Number.parseInt(segment, 10));
  const segmentCount = Math.max(versionSegments.length, minimumSegments.length);
  for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
    const versionSegment = versionSegments[segmentIndex] ?? 0;
    const minimumSegment = minimumSegments[segmentIndex] ?? 0;
    if (versionSegment !== minimumSegment) return versionSegment > minimumSegment;
  }
  return true;
};

const getBrowserProtectionRequirement = (
  browserTarget: string,
): "noopener" | "noreferrer" | "unsupported" | undefined => {
  const separatorIndex = browserTarget.lastIndexOf(" ");
  if (separatorIndex < 0) return undefined;

  const browserName = browserTarget.slice(0, separatorIndex);
  const support = TARGET_BLANK_BROWSER_SUPPORT.find(
    (candidate) => candidate.browserName === browserName,
  );
  if (!support || !support.supportsTargetBlankBrowsingContext) return undefined;

  const browserVersion = browserTarget.slice(separatorIndex + 1);
  if (getLowestBrowserVersion(browserVersion) === null) return undefined;
  if (
    support.implicitNoopenerVersion !== null &&
    isBrowserVersionAtLeast(browserVersion, support.implicitNoopenerVersion)
  ) {
    return undefined;
  }
  if (
    support.explicitNoopenerVersion !== null &&
    isBrowserVersionAtLeast(browserVersion, support.explicitNoopenerVersion)
  ) {
    return "noopener";
  }
  return support.explicitNoreferrerVersion !== null &&
    isBrowserVersionAtLeast(browserVersion, support.explicitNoreferrerVersion)
    ? "noreferrer"
    : "unsupported";
};

export const clearTargetBlankOpenerProtectionCache = (): void => {
  browserslist.clearCaches();
};

const getBrowserslistProtectionRequirement = (
  directory: string,
): "noopener" | "noreferrer" | "unsupported" | undefined => {
  try {
    const queries = browserslist.loadConfig({ path: directory, env: "production" });
    if (!queries) return undefined;

    let requirement: "noopener" | "noreferrer" | undefined;
    let hasUnsupportedTarget = false;
    for (const browserTarget of browserslist(queries)) {
      const browserRequirement = getBrowserProtectionRequirement(browserTarget);
      if (browserRequirement === "unsupported") hasUnsupportedTarget = true;
      if (browserRequirement === "noreferrer") requirement = "noreferrer";
      if (browserRequirement === "noopener" && requirement === undefined) {
        requirement = "noopener";
      }
    }
    return requirement ?? (hasUnsupportedTarget ? "unsupported" : undefined);
  } catch {
    return undefined;
  }
};

const getElectronProtectionRequirement = (
  packageJson: PackageJson,
): "noopener" | "noreferrer" | undefined => {
  const electronVersion = getDependencySpec(packageJson, "electron");
  if (electronVersion === null) return undefined;
  const normalizedElectronVersion = normalizeDependencyVersion(electronVersion);
  if (normalizedElectronVersion === null) return undefined;
  const validRange = semver.validRange(normalizedElectronVersion);
  if (validRange === null) return undefined;
  const minimumElectronVersion = semver.minVersion(validRange);
  if (minimumElectronVersion === null) return undefined;
  if (semver.gte(minimumElectronVersion, ELECTRON_IMPLICIT_NOOPENER_MIN_VERSION)) {
    return undefined;
  }
  return semver.gte(minimumElectronVersion, ELECTRON_EXPLICIT_NOOPENER_MIN_VERSION)
    ? "noopener"
    : "noreferrer";
};

export const detectTargetBlankOpenerProtection = (
  directory: string,
  packageJson: PackageJson,
): "noopener" | "noreferrer" | undefined => {
  const browserslistRequirement = getBrowserslistProtectionRequirement(directory);
  const electronRequirement = getElectronProtectionRequirement(packageJson);
  if (browserslistRequirement === "noreferrer" || electronRequirement === "noreferrer") {
    return "noreferrer";
  }
  if (browserslistRequirement === "noopener" || electronRequirement === "noopener") {
    return "noopener";
  }
  return undefined;
};
