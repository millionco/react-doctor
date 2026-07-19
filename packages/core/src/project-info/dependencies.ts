import * as fs from "node:fs";
import * as path from "node:path";
import type { DependencyInfo, PackageJson } from "../types/index.js";
import { detectFramework } from "./detectors.js";
import { isFile, isPlainObject } from "./fs-utils.js";
import { findMonorepoRoot } from "./monorepo-root.js";
import { readPackageJson } from "./package-json.js";
import { isConcreteDependencyVersion } from "./version.js";

export const isCatalogReference = (version: unknown): version is string =>
  typeof version === "string" && version.startsWith("catalog:");

export const extractCatalogName = (version: unknown): string | null => {
  if (!isCatalogReference(version)) return null;
  const name = version.slice("catalog:".length).trim();
  return name.length > 0 ? name : null;
};

const resolveVersionFromCatalog = (
  catalog: Record<string, unknown>,
  packageName: string,
): string | null => {
  const version = catalog[packageName];
  if (typeof version === "string" && !isCatalogReference(version)) return version;
  return null;
};

interface CatalogCollection {
  defaultCatalog: Record<string, string>;
  namedCatalogs: Record<string, Record<string, string>>;
}

interface ResolveCatalogVersionOptions {
  catalogReference: string | null;
  shouldSearchUnreferencedNamedCatalogs: boolean;
}

const parsePnpmWorkspaceCatalogs = (rootDirectory: string): CatalogCollection => {
  const workspacePath = path.join(rootDirectory, "pnpm-workspace.yaml");
  if (!isFile(workspacePath)) return { defaultCatalog: {}, namedCatalogs: {} };

  const content = fs.readFileSync(workspacePath, "utf-8");
  const defaultCatalog: Record<string, string> = {};
  const namedCatalogs: Record<string, Record<string, string>> = {};

  let currentSection: "none" | "catalog" | "catalogs" | "named-catalog" = "none";
  let currentCatalogName = "";

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;

    const indentLevel = line.search(/\S/);

    if (indentLevel === 0 && trimmed === "catalog:") {
      currentSection = "catalog";
      continue;
    }
    if (indentLevel === 0 && trimmed === "catalogs:") {
      currentSection = "catalogs";
      continue;
    }
    if (indentLevel === 0) {
      currentSection = "none";
      continue;
    }

    if (currentSection === "catalog" && indentLevel > 0) {
      const colonIndex = trimmed.indexOf(":");
      if (colonIndex > 0) {
        const key = trimmed.slice(0, colonIndex).trim().replace(/["']/g, "");
        const value = trimmed
          .slice(colonIndex + 1)
          .trim()
          .replace(/["']/g, "");
        if (key && value) defaultCatalog[key] = value;
      }
      continue;
    }

    if (currentSection === "catalogs" && indentLevel > 0) {
      if (trimmed.endsWith(":") && !trimmed.includes(" ")) {
        currentCatalogName = trimmed.slice(0, -1).replace(/["']/g, "");
        currentSection = "named-catalog";
        namedCatalogs[currentCatalogName] = {};
        continue;
      }
    }

    if (currentSection === "named-catalog" && indentLevel > 0) {
      if (indentLevel <= 2 && trimmed.endsWith(":") && !trimmed.includes(" ")) {
        currentCatalogName = trimmed.slice(0, -1).replace(/["']/g, "");
        namedCatalogs[currentCatalogName] = {};
        continue;
      }
      const colonIndex = trimmed.indexOf(":");
      if (colonIndex > 0 && currentCatalogName) {
        const key = trimmed.slice(0, colonIndex).trim().replace(/["']/g, "");
        const value = trimmed
          .slice(colonIndex + 1)
          .trim()
          .replace(/["']/g, "");
        if (key && value) namedCatalogs[currentCatalogName][key] = value;
      }
    }
  }

  return { defaultCatalog, namedCatalogs };
};

const resolveCatalogVersionFromCollection = (
  catalogs: CatalogCollection,
  packageName: string,
  options: ResolveCatalogVersionOptions,
): string | null => {
  const { catalogReference, shouldSearchUnreferencedNamedCatalogs } = options;
  if (catalogReference) {
    const namedCatalog = catalogs.namedCatalogs[catalogReference];
    if (namedCatalog?.[packageName]) return namedCatalog[packageName];
  }

  if (catalogs.defaultCatalog[packageName]) return catalogs.defaultCatalog[packageName];

  if (!shouldSearchUnreferencedNamedCatalogs) return null;

  for (const namedCatalog of Object.values(catalogs.namedCatalogs)) {
    if (namedCatalog[packageName]) return namedCatalog[packageName];
  }

  return null;
};

export const resolveCatalogVersion = (
  packageJson: PackageJson,
  packageName: string,
  rootDirectory?: string,
  // HACK: when this resolver runs against the MONOREPO ROOT
  // package.json (which typically has no `react` dep of its own),
  // the catalog reference must come from the LEAF package that
  // actually wrote `"react": "catalog:react19"`. Without an explicit
  // reference, the named-catalog lookup below would always fall
  // through to the `Object.values()` scan and return an arbitrary
  // group — losing fidelity when multiple grouped catalogs (e.g.
  // `react18` and `react19`) define the same package at different
  // versions. Callers that already have the leaf's catalog reference
  // pass it in; everyone else falls back to the in-this-package
  // dependency, which still covers the common single-package case.
  explicitCatalogReference?: string | null,
): string | null => {
  const allDependencies = {
    ...packageJson.peerDependencies,
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };
  const rawVersion = allDependencies[packageName];
  const hasExplicitCatalogReference = explicitCatalogReference !== undefined;
  const catalogName = hasExplicitCatalogReference
    ? explicitCatalogReference
    : rawVersion
      ? extractCatalogName(rawVersion)
      : null;
  const shouldSearchUnreferencedNamedCatalogs =
    !hasExplicitCatalogReference && catalogName === null;

  if (isPlainObject(packageJson.catalog)) {
    const version = resolveVersionFromCatalog(packageJson.catalog, packageName);
    if (version) return version;
  }

  if (isPlainObject(packageJson.catalogs)) {
    const namedCatalog = catalogName ? packageJson.catalogs[catalogName] : undefined;
    if (namedCatalog && isPlainObject(namedCatalog)) {
      const version = resolveVersionFromCatalog(namedCatalog, packageName);
      if (version) return version;
    }
    if (shouldSearchUnreferencedNamedCatalogs) {
      for (const catalogEntries of Object.values(packageJson.catalogs)) {
        if (isPlainObject(catalogEntries)) {
          const version = resolveVersionFromCatalog(catalogEntries, packageName);
          if (version) return version;
        }
      }
    }
  }

  const workspaces = packageJson.workspaces;
  if (workspaces && !Array.isArray(workspaces)) {
    if (isPlainObject(workspaces.catalog)) {
      const version = resolveVersionFromCatalog(workspaces.catalog, packageName);
      if (version) return version;
    }

    if (isPlainObject(workspaces.catalogs)) {
      const namedCatalog = catalogName ? workspaces.catalogs[catalogName] : undefined;
      if (namedCatalog && isPlainObject(namedCatalog)) {
        const version = resolveVersionFromCatalog(namedCatalog, packageName);
        if (version) return version;
      }
      if (shouldSearchUnreferencedNamedCatalogs) {
        for (const catalogEntries of Object.values(workspaces.catalogs)) {
          if (isPlainObject(catalogEntries)) {
            const version = resolveVersionFromCatalog(catalogEntries, packageName);
            if (version) return version;
          }
        }
      }
    }
  }

  if (rootDirectory) {
    const pnpmCatalogs = parsePnpmWorkspaceCatalogs(rootDirectory);
    const pnpmVersion = resolveCatalogVersionFromCollection(pnpmCatalogs, packageName, {
      catalogReference: catalogName,
      shouldSearchUnreferencedNamedCatalogs,
    });
    if (pnpmVersion) return pnpmVersion;
  }

  return null;
};

// Per-dependency section probe order (which manifest section wins when a
// package is declared in several). React prefers `peerDependencies` over
// `devDependencies` (library manifests declare their supported range there);
// tailwind/zod prefer `devDependencies`.
export const REACT_SECTIONS = ["dependencies", "peerDependencies", "devDependencies"] as const;
export const TAILWIND_ZOD_SECTIONS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
] as const;
const DEPENDENCY_SPEC_SECTIONS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

export const EMPTY_DEPENDENCY_INFO: DependencyInfo = {
  reactVersion: null,
  tailwindVersion: null,
  zodVersion: null,
  framework: "unknown",
};

const pickConcreteVersion = (
  packageJson: PackageJson,
  packageName: string,
  sections: ReadonlyArray<"dependencies" | "peerDependencies" | "devDependencies">,
): string | null => {
  for (const section of sections) {
    const version = packageJson[section]?.[packageName];
    if (typeof version !== "string") continue;
    if (isCatalogReference(version)) return null;
    if (isConcreteDependencyVersion(version)) return version;
  }
  return null;
};

export const extractDependencyInfo = (packageJson: PackageJson): DependencyInfo => {
  const allDependencies = {
    ...packageJson.peerDependencies,
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };
  const reactVersion = pickConcreteVersion(packageJson, "react", [
    "dependencies",
    "peerDependencies",
    "devDependencies",
  ]);
  const tailwindVersion = pickConcreteVersion(packageJson, "tailwindcss", [
    "dependencies",
    "devDependencies",
    "peerDependencies",
  ]);
  const zodVersion = pickConcreteVersion(packageJson, "zod", [
    "dependencies",
    "devDependencies",
    "peerDependencies",
  ]);
  return {
    reactVersion,
    tailwindVersion,
    zodVersion,
    framework: detectFramework(allDependencies),
  };
};

// Reads a package's declared version spec from any of the four dependency
// sections (runtime → dev → peer → optional), so detection matches the
// framework / RN-workspace gates that also treat `peer`/`optional` entries as
// present. The `typeof` guard keeps a malformed non-string entry (e.g.
// `"expo": 54`) from reaching downstream `.trim()` parsing and aborting the scan.
export const getDependencySpec = (packageJson: PackageJson, packageName: string): string | null => {
  for (const section of DEPENDENCY_SPEC_SECTIONS) {
    const spec = packageJson[section]?.[packageName];
    if (typeof spec === "string") return spec;
  }
  return null;
};

interface DependencyDeclaration {
  catalogReference: string | null;
  hasDeclaration: boolean;
  version: string | null;
}

interface GetDependencyDeclarationOptions {
  packageJson: PackageJson;
  packageName: string;
  sections: ReadonlyArray<
    "dependencies" | "peerDependencies" | "devDependencies" | "optionalDependencies"
  >;
}

export const getDependencyDeclaration = ({
  packageJson,
  packageName,
  sections,
}: GetDependencyDeclarationOptions): DependencyDeclaration => {
  for (const section of sections) {
    const version = packageJson[section]?.[packageName];
    if (typeof version !== "string") continue;

    return {
      catalogReference: extractCatalogName(version) ?? null,
      hasDeclaration: true,
      version,
    };
  }

  return {
    catalogReference: null,
    hasDeclaration: false,
    version: null,
  };
};

const REACT_DEPENDENCY_NAMES = new Set(["react", "react-native", "next", "preact"]);

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

export const getPreactVersion = (packageJson: PackageJson): string | null => {
  const allDependencies = {
    ...packageJson.peerDependencies,
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };
  return allDependencies.preact ?? null;
};

interface ResolveCatalogBackedDependencyVersionOptions {
  rootDirectory: string;
  rootPackageJson: PackageJson;
  packageName: string;
  sourceDirectory?: string;
  sourcePackageJson?: PackageJson;
  version: string | null;
}

export const resolveCatalogBackedDependencyVersion = ({
  rootDirectory,
  rootPackageJson,
  packageName,
  sourceDirectory = rootDirectory,
  sourcePackageJson = rootPackageJson,
  version,
}: ResolveCatalogBackedDependencyVersionOptions): string | null => {
  if (version === null || !isCatalogReference(version)) return version;

  const catalogName = extractCatalogName(version);
  const resolvedSourceVersion = resolveCatalogVersion(
    sourcePackageJson,
    packageName,
    sourceDirectory,
    catalogName,
  );
  if (resolvedSourceVersion) return resolvedSourceVersion;

  if (sourceDirectory !== rootDirectory || sourcePackageJson !== rootPackageJson) {
    const resolvedRootVersion = resolveCatalogVersion(
      rootPackageJson,
      packageName,
      rootDirectory,
      catalogName,
    );
    if (resolvedRootVersion) return resolvedRootVersion;
  }

  const monorepoRoot = findMonorepoRoot(rootDirectory);
  if (!monorepoRoot) return version;

  const monorepoPackageJsonPath = path.join(monorepoRoot, "package.json");
  if (!isFile(monorepoPackageJsonPath)) return version;

  return (
    resolveCatalogVersion(
      readPackageJson(monorepoPackageJsonPath),
      packageName,
      monorepoRoot,
      catalogName,
    ) ?? version
  );
};
