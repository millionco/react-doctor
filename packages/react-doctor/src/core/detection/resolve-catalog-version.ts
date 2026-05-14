import fs from "node:fs";
import path from "node:path";
import type { PackageJson } from "../../types/project-info.js";
import { isFile } from "../is-file.js";
import { isPlainObject } from "../is-plain-object.js";
import { collectAllDependencies } from "./collect-all-dependencies.js";

export const isCatalogReference = (version: string): boolean => version.startsWith("catalog:");

export const extractCatalogName = (version: string): string | null => {
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
  catalogReference?: string | null,
): string | null => {
  if (catalogReference) {
    const namedCatalog = catalogs.namedCatalogs[catalogReference];
    if (namedCatalog?.[packageName]) return namedCatalog[packageName];
  }

  if (catalogs.defaultCatalog[packageName]) return catalogs.defaultCatalog[packageName];

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
  const allDependencies = collectAllDependencies(packageJson);
  const rawVersion = allDependencies[packageName];
  // HACK: prefer the caller-provided reference when present, but fall
  // through (?? rather than !== undefined) when the leaf had no
  // catalog reference of its own. That way a root package.json that
  // happens to declare its own `react: "catalog:<group>"` still drives
  // the named lookup, instead of being silently ignored just because
  // the leaf passed `null`.
  const catalogName =
    explicitCatalogReference ?? (rawVersion ? extractCatalogName(rawVersion) : null);

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
    for (const catalogEntries of Object.values(packageJson.catalogs)) {
      if (isPlainObject(catalogEntries)) {
        const version = resolveVersionFromCatalog(catalogEntries, packageName);
        if (version) return version;
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
      for (const catalogEntries of Object.values(workspaces.catalogs)) {
        if (isPlainObject(catalogEntries)) {
          const version = resolveVersionFromCatalog(catalogEntries, packageName);
          if (version) return version;
        }
      }
    }
  }

  if (rootDirectory) {
    const pnpmCatalogs = parsePnpmWorkspaceCatalogs(rootDirectory);
    const pnpmVersion = resolveCatalogVersionFromCollection(pnpmCatalogs, packageName, catalogName);
    if (pnpmVersion) return pnpmVersion;
  }

  return null;
};
