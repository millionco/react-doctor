import {
  isExpoManagedDependencyName,
  isReactNativeDependencyName,
} from "../../react-native-dependency-names.js";
import { readNearestPackageManifest } from "./read-nearest-package-manifest.js";
import type { PackageManifest } from "./read-nearest-package-manifest.js";

export { findNearestPackageDirectory } from "./read-nearest-package-manifest.js";

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

const DEPENDENCY_SECTION_NAMES = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const satisfies ReadonlyArray<keyof PackageManifest>;

const iterateDependencyNames = function* (manifest: PackageManifest): Generator<string> {
  for (const sectionName of DEPENDENCY_SECTION_NAMES) {
    const section = manifest[sectionName];
    if (!section) continue;
    for (const dependencyName of Object.keys(section)) {
      yield dependencyName;
    }
  }
};

const isReactNativeAware = (manifest: PackageManifest): boolean => {
  if (typeof manifest["react-native"] === "string") return true;
  for (const dependencyName of iterateDependencyNames(manifest)) {
    if (isReactNativeDependencyName(dependencyName)) return true;
  }
  return false;
};

const isExpoManaged = (manifest: PackageManifest): boolean => {
  for (const dependencyName of iterateDependencyNames(manifest)) {
    if (isExpoManagedDependencyName(dependencyName)) return true;
  }
  return false;
};

const isWebFrameworkOnly = (manifest: PackageManifest): boolean => {
  for (const dependencyName of iterateDependencyNames(manifest)) {
    if (WEB_FRAMEWORK_DEPENDENCY_NAMES.has(dependencyName)) return true;
  }
  return false;
};

export const declaresAnyDependency = (manifest: PackageManifest): boolean =>
  DEPENDENCY_SECTION_NAMES.some((sectionName) => {
    const section = manifest[sectionName];
    return typeof section === "object" && section !== null && Object.keys(section).length > 0;
  });

export const declaresDependency = (manifest: PackageManifest, dependencyName: string): boolean =>
  DEPENDENCY_SECTION_NAMES.some((sectionName) => {
    const section = manifest[sectionName];
    return (
      typeof section === "object" &&
      section !== null &&
      Object.prototype.propertyIsEnumerable.call(section, dependencyName)
    );
  });

export type PackagePlatform = "expo" | "react-native" | "web" | "neutral" | "unknown";

// The classification is a pure function of one parsed manifest, so memoizing
// by manifest OBJECT identity (the reader returns the same cached object for
// every file in a package) keeps the per-file cost at a WeakMap hit — and the
// memo dies with the manifest entry when `resetManifestCaches` drops it, so
// there is no second cache to invalidate.
const cachedPlatformByManifest = new WeakMap<PackageManifest, PackagePlatform>();

// Classifies the package owning `filename`:
//
//   "expo"         — the nearest `package.json` declares an Expo-managed
//                    app dependency such as `expo` or `expo-router`.
//
//   "react-native" — the nearest `package.json` declares a React Native
//                    dependency. Mixed RN+web monorepo packages (which
//                    deliberately ship both `react-native` and `react-dom`
//                    for `react-native-web`) ALSO land here: RN takes
//                    precedence so RN rules continue to fire on files that
//                    target mobile.
//
//   "web"          — the nearest `package.json` declares a web-only
//                    framework (`next`, `vite`, `react-scripts`,
//                    `gatsby`, `@remix-run/react`, `@docusaurus/core`,
//                    `@storybook/...`) or a plain `react-dom` runtime
//                    without any RN indicator. React Native rules MUST
//                    skip files in this bucket.
//
//   "neutral"      — the nearest `package.json` declares its own
//                    dependency surface (at least one dependency in any
//                    section) but neither an RN nor a web-framework
//                    signal. The manifest is authoritative for a nested
//                    workspace package: a monorepo package that depends
//                    on `react-markdown` + `react` but never on
//                    `react-native` is not an RN package even when a
//                    sibling workspace is (see is-react-native-file.ts).
//
//   "unknown"      — no nearest `package.json`, the manifest is
//                    unparseable, or the manifest declares no
//                    dependencies at all (`{}`, `{"type":"module"}`
//                    markers). Callers fall back to the project-level
//                    framework setting (see is-react-native-file.ts).
export const classifyPackagePlatform = (filename: string): PackagePlatform => {
  const manifest = readNearestPackageManifest(filename);
  if (!manifest) return "unknown";

  const cached = cachedPlatformByManifest.get(manifest);
  if (cached !== undefined) return cached;

  let result: PackagePlatform;
  if (isExpoManaged(manifest)) {
    result = "expo";
  } else if (isReactNativeAware(manifest)) {
    result = "react-native";
  } else if (isWebFrameworkOnly(manifest)) {
    result = "web";
  } else if (declaresAnyDependency(manifest)) {
    result = "neutral";
  } else {
    result = "unknown";
  }
  cachedPlatformByManifest.set(manifest, result);
  return result;
};
