import * as fs from "node:fs";
import * as path from "node:path";
import { recordContentProbe, recordExistenceProbe } from "./cross-file-probe-recorder.js";
import type { PackageManifest } from "./read-nearest-package-manifest.js";
import {
  findNearestPackageDirectory,
  readNearestPackageManifest,
} from "./read-nearest-package-manifest.js";

// `boxShadow` shipped in React Native 0.76 and only renders on the New
// Architecture. A package is "legacy arch" — and the boxShadow-based shadow
// rules must stay silent — when any of these hold:
//   - the declared react-native version predates 0.76 (boxShadow missing
//     outright),
//   - `android/gradle.properties` sets `newArchEnabled=false`,
//   - a static Expo app config sets `newArchEnabled: false` (skipped when a
//     dynamic `app.config.{js,ts,cjs,mjs}` exists, since that file can flip
//     the flag at build time and we can't evaluate it offline — mirrors
//     core's `readExpoAppConfig` policy).
const FIRST_BOX_SHADOW_REACT_NATIVE_MINOR = 76;

const GRADLE_PROPERTIES_RELATIVE_PATH = path.join("android", "gradle.properties");
const NEW_ARCH_DISABLED_GRADLE_PATTERN = /^\s*newArchEnabled\s*=\s*false\s*$/m;

const DYNAMIC_EXPO_CONFIG_FILENAMES = [
  "app.config.ts",
  "app.config.js",
  "app.config.cjs",
  "app.config.mjs",
] as const;
const STATIC_EXPO_CONFIG_FILENAMES = ["app.config.json", "app.json"] as const;

// Verdicts memoized by manifest object identity, like
// `classify-package-platform`: the manifest cache in
// `read-nearest-package-manifest` returns the same object for every file in a
// package, and `resetManifestCaches` dropping that entry kills this memo too.
const cachedVerdictByManifest = new WeakMap<PackageManifest, boolean>();

const recordFilesystemProbes = (packageDirectory: string): void => {
  recordContentProbe(path.join(packageDirectory, GRADLE_PROPERTIES_RELATIVE_PATH));
  for (const dynamicFilename of DYNAMIC_EXPO_CONFIG_FILENAMES) {
    recordExistenceProbe(path.join(packageDirectory, dynamicFilename));
  }
  for (const staticFilename of STATIC_EXPO_CONFIG_FILENAMES) {
    recordContentProbe(path.join(packageDirectory, staticFilename));
  }
};

const readTextFileOrNull = (absolutePath: string): string | null => {
  try {
    return fs.readFileSync(absolutePath, "utf-8");
  } catch {
    return null;
  }
};

const declaredReactNativeVersionSpec = (manifest: PackageManifest): string | null => {
  const spec =
    manifest.dependencies?.["react-native"] ?? manifest.devDependencies?.["react-native"];
  return typeof spec === "string" ? spec : null;
};

const parseReactNativeMinor = (versionSpec: string): number | null => {
  const match = versionSpec.match(/(?:^|[^\d.])0\.(\d+)/);
  if (!match) return null;
  return Number.parseInt(match[1], 10);
};

const isNewArchDisabledInGradleProperties = (packageDirectory: string): boolean => {
  const contents = readTextFileOrNull(path.join(packageDirectory, GRADLE_PROPERTIES_RELATIVE_PATH));
  return contents !== null && NEW_ARCH_DISABLED_GRADLE_PATTERN.test(contents);
};

const isNewArchDisabledInStaticExpoConfig = (packageDirectory: string): boolean => {
  for (const dynamicFilename of DYNAMIC_EXPO_CONFIG_FILENAMES) {
    if (fs.existsSync(path.join(packageDirectory, dynamicFilename))) return false;
  }
  for (const staticFilename of STATIC_EXPO_CONFIG_FILENAMES) {
    const contents = readTextFileOrNull(path.join(packageDirectory, staticFilename));
    if (contents === null) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(contents);
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null) continue;
    const expoConfig: unknown = Object.getOwnPropertyDescriptor(parsed, "expo")?.value;
    if (typeof expoConfig !== "object" || expoConfig === null) continue;
    if (Object.getOwnPropertyDescriptor(expoConfig, "newArchEnabled")?.value === false) return true;
  }
  return false;
};

const computeVerdict = (packageDirectory: string, manifest: PackageManifest): boolean => {
  const versionSpec = declaredReactNativeVersionSpec(manifest);
  if (versionSpec !== null) {
    const reactNativeMinor = parseReactNativeMinor(versionSpec);
    if (reactNativeMinor !== null && reactNativeMinor < FIRST_BOX_SHADOW_REACT_NATIVE_MINOR) {
      return true;
    }
  }
  return (
    isNewArchDisabledInGradleProperties(packageDirectory) ||
    isNewArchDisabledInStaticExpoConfig(packageDirectory)
  );
};

export const isLegacyArchReactNativeFile = (filename: string): boolean => {
  const packageDirectory = findNearestPackageDirectory(filename);
  if (!packageDirectory) return false;
  const manifest = readNearestPackageManifest(filename);
  if (!manifest) return false;

  recordFilesystemProbes(packageDirectory);

  const cached = cachedVerdictByManifest.get(manifest);
  if (cached !== undefined) return cached;

  const verdict = computeVerdict(packageDirectory, manifest);
  cachedVerdictByManifest.set(manifest, verdict);
  return verdict;
};
