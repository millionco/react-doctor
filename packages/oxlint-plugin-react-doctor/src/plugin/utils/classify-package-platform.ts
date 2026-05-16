import fs from "node:fs";
import path from "node:path";

// Packages whose presence in a manifest definitively marks the package as
// a React Native (mobile-first) target. `react-native-web` is intentionally
// NOT included here — it's a web compatibility layer and is paired with a
// `react-dom` / Next / Vite host package, not with mobile RN.
const REACT_NATIVE_DEPENDENCY_NAMES: ReadonlySet<string> = new Set([
  "react-native",
  "expo",
  "expo-router",
  "@expo/cli",
  "@expo/metro-config",
  "@expo/metro-runtime",
  "react-native-windows",
  "react-native-macos",
  "@react-native/metro-config",
  "@react-native-community/cli",
]);

// Packages that mark the manifest as a web-only React target. If a manifest
// contains one of these AND has no React Native indicator, every React
// Native rule must skip files inside that package. `react-dom` covers
// any plain React-DOM library; the framework names cover the rest. We
// only treat `react-dom` as web-exclusive when there is no concurrent
// `react-native` declaration (see `classifyPackagePlatform` below).
const WEB_FRAMEWORK_DEPENDENCY_NAMES: ReadonlySet<string> = new Set([
  "next",
  "vite",
  "react-scripts",
  "gatsby",
  "@remix-run/react",
  "@remix-run/node",
  "@docusaurus/core",
  "@docusaurus/preset-classic",
  "@storybook/react",
  "@storybook/react-vite",
  "@storybook/react-webpack5",
  "@storybook/nextjs",
  "@storybook/web-components",
  "storybook",
  "react-dom",
  "@vitejs/plugin-react",
  "@vitejs/plugin-react-swc",
]);

// The lookup is read-only: we walk the directory tree from the file's
// location up to the filesystem root, look for the nearest `package.json`,
// and cache the resulting classification by package directory. Memoizing
// by directory (NOT filename) is essential — every file inside a package
// shares the same answer, and oxlint visits many files per package per
// run.
const cachedPlatformByPackageDirectory = new Map<string, PackagePlatform>();
const cachedPackageDirectoryByFilename = new Map<string, string | null>();

// HACK: exposed so tests can clear results between independent fixtures.
// Without this, a fixture in `/tmp/A` and a re-created fixture at the
// same path would share stale state. Production code never invalidates.
export const clearClassifyPackagePlatformCache = (): void => {
  cachedPlatformByPackageDirectory.clear();
  cachedPackageDirectoryByFilename.clear();
};

const findNearestPackageDirectory = (filename: string): string | null => {
  if (!filename) return null;

  const fromCache = cachedPackageDirectoryByFilename.get(filename);
  if (fromCache !== undefined) return fromCache;

  let currentDirectory = path.dirname(filename);
  while (true) {
    const candidatePackageJsonPath = path.join(currentDirectory, "package.json");
    let hasPackageJson = false;
    try {
      hasPackageJson = fs.statSync(candidatePackageJsonPath).isFile();
    } catch {
      hasPackageJson = false;
    }
    if (hasPackageJson) {
      cachedPackageDirectoryByFilename.set(filename, currentDirectory);
      return currentDirectory;
    }
    const parentDirectory = path.dirname(currentDirectory);
    if (parentDirectory === currentDirectory) {
      cachedPackageDirectoryByFilename.set(filename, null);
      return null;
    }
    currentDirectory = parentDirectory;
  }
};

interface PackageJsonDependencyView {
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
  peerDependencies?: Record<string, unknown>;
  optionalDependencies?: Record<string, unknown>;
}

const readPackageJsonSafe = (packageJsonPath: string): PackageJsonDependencyView | null => {
  let rawContents: string;
  try {
    rawContents = fs.readFileSync(packageJsonPath, "utf-8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(rawContents);
    if (typeof parsed === "object" && parsed !== null) return parsed as PackageJsonDependencyView;
    return null;
  } catch {
    return null;
  }
};

const isReactNativeAware = (packageJson: PackageJsonDependencyView): boolean => {
  for (const section of [
    packageJson.dependencies,
    packageJson.devDependencies,
    packageJson.peerDependencies,
    packageJson.optionalDependencies,
  ]) {
    if (!section) continue;
    for (const dependencyName of Object.keys(section)) {
      if (REACT_NATIVE_DEPENDENCY_NAMES.has(dependencyName)) return true;
    }
  }
  return false;
};

const isWebFrameworkOnly = (packageJson: PackageJsonDependencyView): boolean => {
  for (const section of [
    packageJson.dependencies,
    packageJson.devDependencies,
    packageJson.peerDependencies,
    packageJson.optionalDependencies,
  ]) {
    if (!section) continue;
    for (const dependencyName of Object.keys(section)) {
      if (WEB_FRAMEWORK_DEPENDENCY_NAMES.has(dependencyName)) return true;
    }
  }
  return false;
};

export type PackagePlatform = "react-native" | "web" | "unknown";

// Classifies the package owning `filename`:
//
//   "react-native" — the nearest `package.json` declares a React Native
//                    or Expo dependency. Mixed RN+web monorepo packages
//                    (which deliberately ship both `react-native` and
//                    `react-dom` for `react-native-web`) ALSO land here:
//                    RN takes precedence so RN rules continue to fire on
//                    files that target mobile.
//
//   "web"          — the nearest `package.json` declares a web-only
//                    framework (`next`, `vite`, `react-scripts`,
//                    `gatsby`, `@remix-run/react`, `@docusaurus/core`,
//                    `@storybook/...`) or a plain `react-dom` runtime
//                    without any RN indicator. React Native rules MUST
//                    skip files in this bucket.
//
//   "unknown"      — no nearest `package.json`, the manifest is
//                    unparseable, or the package declares neither
//                    cohort. Callers fall back to the project-level
//                    framework setting (see is-react-native-file.ts).
export const classifyPackagePlatform = (filename: string): PackagePlatform => {
  const packageDirectory = findNearestPackageDirectory(filename);
  if (!packageDirectory) return "unknown";

  const cached = cachedPlatformByPackageDirectory.get(packageDirectory);
  if (cached !== undefined) return cached;

  const packageJsonPath = path.join(packageDirectory, "package.json");
  const packageJson = readPackageJsonSafe(packageJsonPath);
  if (!packageJson) {
    cachedPlatformByPackageDirectory.set(packageDirectory, "unknown");
    return "unknown";
  }

  let result: PackagePlatform;
  if (isReactNativeAware(packageJson)) {
    result = "react-native";
  } else if (isWebFrameworkOnly(packageJson)) {
    result = "web";
  } else {
    result = "unknown";
  }
  cachedPlatformByPackageDirectory.set(packageDirectory, result);
  return result;
};
