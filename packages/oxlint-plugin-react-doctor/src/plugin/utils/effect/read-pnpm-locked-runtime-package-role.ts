import * as fs from "node:fs";
import * as path from "node:path";
import { isAlias, isMap, isScalar, isSeq, parseAllDocuments } from "yaml";
import { recordContentProbe, recordExistenceProbe } from "../cross-file-probe-recorder.js";
import { isPathInside } from "../is-path-inside.js";
import { normalizeFilename } from "../normalize-filename.js";
import { readPackageManifest } from "../read-nearest-package-manifest.js";
import {
  PNPM_LOCK_ROLE_DEPENDENCY_FIELDS,
  PNPM_LOCK_ROLE_MAX_AGGREGATE_BYTES,
  PNPM_LOCK_ROLE_MAX_DEPTH,
  PNPM_LOCK_ROLE_MAX_FILE_BYTES,
  PNPM_LOCK_ROLE_MAX_NODES,
  PNPM_LOCK_ROLE_VERSION,
  PNPM_ROLE_PROTECTED_PACKAGES,
} from "./modern-source-scheduling-role/constants.js";
import { getPnpmRoleSelectorPackage } from "./modern-source-scheduling-role/get-pnpm-role-selector-package.js";

export interface PnpmRuntimeRoleProject {
  readonly packageDirectory: string;
  readonly lockDirectory: string;
  readonly hasDisjointOverrides: (overrides: unknown) => boolean;
}

export interface PnpmLockedRuntimePackageRoleInput {
  readonly packageDirectory: string;
  readonly packageName: string;
  readonly version: string;
  readonly integrity: string;
  readonly catalogSpecifiers: ReadonlyMap<string, string>;
  readonly projects: ReadonlyArray<PnpmRuntimeRoleProject>;
}

export interface PnpmLockedRuntimePackageRole {
  readonly didFindLockfile: boolean;
  readonly hasSupportedResolution: boolean;
  readonly hasContradiction: boolean;
}

interface PnpmLockAstEntry {
  readonly node: unknown;
  readonly depth: number;
}

const isLockMap = (value: unknown): value is Map<string, unknown> => value instanceof Map;

const getReferencedPackageName = (reference: string): string | null => {
  const base = reference.split("(")[0] ?? "";
  const separator = base.indexOf("@", 1);
  return getPnpmRoleSelectorPackage(separator === -1 ? base : base.slice(0, separator));
};

const readLockDocument = (source: string): Map<string, unknown> | null => {
  if (/^%/m.test(source.replace(/^\uFEFF/, ""))) return null;
  const documents = parseAllDocuments(source, {
    version: "1.2",
    schema: "core",
    strict: true,
    uniqueKeys: true,
    merge: false,
    customTags: [],
    resolveKnownTags: false,
  });
  const document = documents[0];
  if (
    documents.length !== 1 ||
    !document ||
    document.errors.length > 0 ||
    document.warnings.length > 0 ||
    document.directives?.yaml.explicit ||
    !isMap(document.contents)
  )
    return null;
  const entries: PnpmLockAstEntry[] = [{ node: document.contents, depth: 0 }];
  let nodeCount = 0;
  while (entries.length > 0) {
    const entry = entries.pop();
    if (!entry) return null;
    const { node, depth } = entry;
    nodeCount += 1;
    if (
      nodeCount > PNPM_LOCK_ROLE_MAX_NODES ||
      depth > PNPM_LOCK_ROLE_MAX_DEPTH ||
      isAlias(node) ||
      !(isMap(node) || isSeq(node) || isScalar(node)) ||
      node.tag ||
      node.anchor
    )
      return null;
    if (isMap(node)) {
      for (const pair of node.items) {
        if (!isScalar(pair.key) || typeof pair.key.value !== "string" || pair.key.value === "<<")
          return null;
        entries.push({ node: pair.key, depth: depth + 1 }, { node: pair.value, depth: depth + 1 });
      }
    } else if (isSeq(node)) {
      for (const item of node.items) entries.push({ node: item, depth: depth + 1 });
    } else if (
      node.value !== null &&
      typeof node.value !== "string" &&
      typeof node.value !== "boolean" &&
      !(typeof node.value === "number" && Number.isFinite(node.value))
    )
      return null;
  }
  const project = (node: unknown): unknown => {
    if (isScalar(node)) return node.value;
    if (isSeq(node)) return node.items.map(project);
    if (!isMap(node)) return undefined;
    const record = new Map<string, unknown>();
    for (const pair of node.items) {
      if (!isScalar(pair.key) || typeof pair.key.value !== "string") return undefined;
      record.set(pair.key.value, project(pair.value));
    }
    return record;
  };
  const projected = project(document.contents);
  return isLockMap(projected) ? projected : null;
};

const getRegistryPackageName = (locator: string): string | null => {
  try {
    const url = new URL(locator);
    if (url.protocol !== "https:" || url.hostname !== "registry.npmjs.org") return null;
    const name = decodeURIComponent(url.pathname).match(/^\/(@[^/]+\/[^/]+|[^/]+)\/-\//)?.[1];
    return name ? getPnpmRoleSelectorPackage(name) : null;
  } catch {
    return null;
  }
};

const getKnownLocalPackageName = (
  locator: string,
  directory: string,
  root: string,
): string | null => {
  const target = path.resolve(directory, locator);
  if (!isPathInside(target, root)) return null;
  const manifest = readPackageManifest(target);
  return typeof manifest?.name === "string" ? manifest.name : null;
};

const hasProtectedAlias = (
  name: string,
  reference: string,
  directory: string,
  root: string,
): boolean => {
  const value = reference.trim();
  if (value.startsWith("workspace:")) {
    const requested = value.slice("workspace:".length);
    const target = requested.startsWith(".")
      ? getKnownLocalPackageName(requested, directory, root)
      : getPnpmRoleSelectorPackage(requested);
    return (
      PNPM_ROLE_PROTECTED_PACKAGES.has(name) ||
      Boolean(target && PNPM_ROLE_PROTECTED_PACKAGES.has(target) && target !== name)
    );
  }
  if (/^(?:file|link):/.test(value)) {
    const target = getKnownLocalPackageName(value.slice(value.indexOf(":") + 1), directory, root);
    if (target && PNPM_ROLE_PROTECTED_PACKAGES.has(target) && target !== name) return true;
  }
  if (
    PNPM_ROLE_PROTECTED_PACKAGES.has(name) &&
    /^[a-z][a-z0-9+.-]*:/i.test(value) &&
    !value.startsWith("catalog:")
  )
    return true;
  const registryName = getRegistryPackageName(value);
  if (registryName) return PNPM_ROLE_PROTECTED_PACKAGES.has(registryName) && registryName !== name;
  if (/^npm:/i.test(value)) {
    const target = value.startsWith("npm:")
      ? getPnpmRoleSelectorPackage(value.slice("npm:".length))
      : null;
    return (
      !target || PNPM_ROLE_PROTECTED_PACKAGES.has(name) || PNPM_ROLE_PROTECTED_PACKAGES.has(target)
    );
  }
  if (value.indexOf("@", 1) !== -1) {
    const target = getReferencedPackageName(value);
    if (
      target &&
      target !== name &&
      (PNPM_ROLE_PROTECTED_PACKAGES.has(name) || PNPM_ROLE_PROTECTED_PACKAGES.has(target))
    )
      return true;
  }
  return (
    PNPM_ROLE_PROTECTED_PACKAGES.has(name) &&
    /^[a-z][a-z0-9+.-]*:/i.test(value) &&
    !value.startsWith("catalog:")
  );
};

const hasSupportedGlobalIdentityEdges = (
  lock: Map<string, unknown>,
  project: PnpmRuntimeRoleProject,
): boolean => {
  if (
    lock.get("lockfileVersion") !== PNPM_LOCK_ROLE_VERSION ||
    lock.has("pnpmfileChecksum") ||
    lock.has("packageExtensionsChecksum")
  )
    return false;
  const overrides = lock.get("overrides");
  if (
    overrides !== undefined &&
    (!isLockMap(overrides) ||
      [...overrides.values()].some((value) => typeof value !== "string") ||
      !project.hasDisjointOverrides(Object.fromEntries(overrides)))
  )
    return false;
  const patches = lock.get("patchedDependencies");
  if (patches !== undefined) {
    if (!isLockMap(patches)) return false;
    for (const selector of patches.keys()) {
      const name = getPnpmRoleSelectorPackage(selector);
      if (!name || PNPM_ROLE_PROTECTED_PACKAGES.has(name)) return false;
    }
  }
  const catalogs = lock.get("catalogs");
  const importers = lock.get("importers");
  if (isLockMap(importers)) {
    for (const [importerId, importer] of importers) {
      if (!isLockMap(importer)) continue;
      const directory = path.resolve(project.lockDirectory, importerId);
      for (const field of PNPM_LOCK_ROLE_DEPENDENCY_FIELDS) {
        const dependencies = importer.get(field);
        if (!isLockMap(dependencies)) continue;
        for (const [name, dependency] of dependencies) {
          if (!isLockMap(dependency)) continue;
          const specifier = dependency.get("specifier");
          const version = dependency.get("version");
          if (
            typeof specifier === "string" &&
            hasProtectedAlias(name, specifier, directory, project.lockDirectory)
          )
            return false;
          if (
            typeof version === "string" &&
            hasProtectedAlias(name, version, directory, project.lockDirectory)
          )
            return false;
          if (typeof specifier === "string" && specifier.startsWith("catalog:")) {
            const catalogName = specifier.slice("catalog:".length) || "default";
            const catalog = isLockMap(catalogs) ? catalogs.get(catalogName) : null;
            const entry = isLockMap(catalog) ? catalog.get(name) : null;
            if (!isLockMap(entry)) continue;
            const actualSpecifier = entry.get("specifier");
            const actualVersion = entry.get("version");
            if (
              (typeof actualSpecifier === "string" &&
                hasProtectedAlias(name, actualSpecifier, directory, project.lockDirectory)) ||
              (typeof actualVersion === "string" &&
                hasProtectedAlias(name, actualVersion, directory, project.lockDirectory))
            )
              return false;
          }
        }
      }
    }
  }
  const packages = lock.get("packages");
  if (isLockMap(packages)) {
    for (const [packageId, info] of packages) {
      if (!isLockMap(info)) continue;
      const name = getReferencedPackageName(packageId);
      const recordedName = info.get("name");
      if (
        typeof recordedName === "string" &&
        PNPM_ROLE_PROTECTED_PACKAGES.has(recordedName) &&
        recordedName !== name
      )
        return false;
      if (
        name &&
        PNPM_ROLE_PROTECTED_PACKAGES.has(name) &&
        typeof recordedName === "string" &&
        recordedName !== name
      )
        return false;
      const resolution = info.get("resolution");
      if (
        name &&
        PNPM_ROLE_PROTECTED_PACKAGES.has(name) &&
        isLockMap(resolution) &&
        resolution.has("type")
      )
        return false;
      const tarball = isLockMap(resolution) ? resolution.get("tarball") : null;
      const tarballName = typeof tarball === "string" ? getRegistryPackageName(tarball) : null;
      if (tarballName && PNPM_ROLE_PROTECTED_PACKAGES.has(tarballName) && tarballName !== name)
        return false;
      const directory =
        isLockMap(resolution) && resolution.get("type") === "directory"
          ? resolution.get("directory")
          : null;
      const localName =
        typeof directory === "string"
          ? getKnownLocalPackageName(directory, project.lockDirectory, project.lockDirectory)
          : null;
      if (localName && PNPM_ROLE_PROTECTED_PACKAGES.has(localName) && localName !== name)
        return false;
    }
  }
  const snapshots = lock.get("snapshots");
  if (isLockMap(snapshots)) {
    for (const snapshot of snapshots.values()) {
      if (!isLockMap(snapshot)) continue;
      for (const field of ["dependencies", "optionalDependencies"]) {
        const dependencies = snapshot.get(field);
        if (!isLockMap(dependencies)) continue;
        for (const [name, version] of dependencies)
          if (
            typeof version === "string" &&
            hasProtectedAlias(name, version, project.lockDirectory, project.lockDirectory)
          )
            return false;
      }
    }
  }
  return true;
};

export const readPnpmLockedRuntimePackageRole = (
  input: PnpmLockedRuntimePackageRoleInput,
): PnpmLockedRuntimePackageRole => {
  let didFindLockfile = false;
  let hasSupportedResolution = false;
  let aggregateBytes = 0;
  const seenLockDirectories = new Set<string>();
  for (const project of input.projects) {
    if (
      !path.isAbsolute(project.packageDirectory) ||
      !path.isAbsolute(project.lockDirectory) ||
      !isPathInside(project.packageDirectory, project.lockDirectory)
    )
      return { didFindLockfile, hasSupportedResolution: false, hasContradiction: true };
    const isSelectedProject =
      normalizeFilename(project.packageDirectory) === normalizeFilename(input.packageDirectory);
    const lockDirectoryKey = normalizeFilename(project.lockDirectory);
    const lockPath = path.join(project.lockDirectory, "pnpm-lock.yaml");
    recordExistenceProbe(lockPath);
    try {
      if (!fs.lstatSync(lockPath, { throwIfNoEntry: false })) continue;
    } catch {
      return { didFindLockfile, hasSupportedResolution: false, hasContradiction: true };
    }
    if (isSelectedProject) didFindLockfile = true;
    if (seenLockDirectories.has(lockDirectoryKey) && !isSelectedProject) continue;
    const rootManifest = readPackageManifest(project.lockDirectory);
    if (
      !rootManifest ||
      typeof Reflect.get(rootManifest, "packageManager") !== "string" ||
      !/^pnpm@10\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(Reflect.get(rootManifest, "packageManager"))
    )
      return { didFindLockfile, hasSupportedResolution: false, hasContradiction: true };
    let source: string;
    try {
      const stat = fs.lstatSync(lockPath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > PNPM_LOCK_ROLE_MAX_FILE_BYTES)
        return { didFindLockfile, hasSupportedResolution: false, hasContradiction: true };
      recordContentProbe(lockPath);
      source = fs.readFileSync(lockPath, "utf8");
      const bytes = Buffer.byteLength(source);
      if (!seenLockDirectories.has(lockDirectoryKey)) aggregateBytes += bytes;
      if (
        bytes > PNPM_LOCK_ROLE_MAX_FILE_BYTES ||
        aggregateBytes > PNPM_LOCK_ROLE_MAX_AGGREGATE_BYTES
      )
        return { didFindLockfile, hasSupportedResolution: false, hasContradiction: true };
    } catch {
      return { didFindLockfile, hasSupportedResolution: false, hasContradiction: true };
    }
    seenLockDirectories.add(lockDirectoryKey);
    let lock: Map<string, unknown> | null;
    try {
      lock = readLockDocument(source);
    } catch {
      return { didFindLockfile, hasSupportedResolution: false, hasContradiction: true };
    }
    if (!lock || !hasSupportedGlobalIdentityEdges(lock, project))
      return { didFindLockfile, hasSupportedResolution: false, hasContradiction: true };
    if (!isSelectedProject) continue;
    const importerId =
      path.relative(project.lockDirectory, project.packageDirectory).split(path.sep).join("/") ||
      ".";
    const importers = lock.get("importers");
    const importer = isLockMap(importers) ? importers.get(importerId) : null;
    const manifest = readPackageManifest(project.packageDirectory);
    if (!isLockMap(importer) || !manifest)
      return { didFindLockfile, hasSupportedResolution: false, hasContradiction: true };
    const metadata = importer.get("dependenciesMeta");
    if (metadata !== undefined) {
      if (!isLockMap(metadata))
        return { didFindLockfile, hasSupportedResolution: false, hasContradiction: true };
      const selectedMetadata = metadata.get(input.packageName);
      if (
        selectedMetadata !== undefined &&
        (!isLockMap(selectedMetadata) ||
          selectedMetadata.size !== 1 ||
          selectedMetadata.get("injected") !== false)
      )
        return { didFindLockfile, hasSupportedResolution: false, hasContradiction: true };
    }
    let didFindDependency = false;
    for (const field of PNPM_LOCK_ROLE_DEPENDENCY_FIELDS) {
      const dependencies = Reflect.get(manifest, field);
      const declared = dependencies?.[input.packageName];
      const lockedDependencies = importer.get(field);
      const locked = isLockMap(lockedDependencies)
        ? lockedDependencies.get(input.packageName)
        : undefined;
      if (declared === undefined && locked === undefined) continue;
      if (
        typeof declared !== "string" ||
        !isLockMap(locked) ||
        [...locked.keys()].some((key) => key !== "specifier" && key !== "version") ||
        locked.get("specifier") !== declared ||
        locked.get("version") !== input.version
      )
        return { didFindLockfile, hasSupportedResolution: false, hasContradiction: true };
      if (declared.startsWith("catalog:")) {
        const name = declared.slice("catalog:".length) || "default";
        const catalogs = lock.get("catalogs");
        const catalog = isLockMap(catalogs) ? catalogs.get(name) : null;
        const entry = isLockMap(catalog) ? catalog.get(input.packageName) : null;
        const specifier = isLockMap(entry) ? entry.get("specifier") : null;
        if (
          !isLockMap(entry) ||
          entry.get("version") !== input.version ||
          typeof specifier !== "string" ||
          specifier !== input.catalogSpecifiers.get(declared) ||
          ![input.version, `^${input.version}`, `~${input.version}`].includes(specifier)
        )
          return { didFindLockfile, hasSupportedResolution: false, hasContradiction: true };
      }
      didFindDependency = true;
    }
    const packageId = `${input.packageName}@${input.version}`;
    const packages = lock.get("packages");
    const packageInfo = isLockMap(packages) ? packages.get(packageId) : null;
    const snapshots = lock.get("snapshots");
    const snapshot = isLockMap(snapshots) ? snapshots.get(packageId) : null;
    const resolution = isLockMap(packageInfo) ? packageInfo.get("resolution") : null;
    if (
      !didFindDependency ||
      !isLockMap(packageInfo) ||
      [...packageInfo.keys()].some((name) => !["resolution", "engines", "hasBin"].includes(name)) ||
      !isLockMap(resolution) ||
      resolution.size !== 1 ||
      resolution.get("integrity") !== input.integrity ||
      !isLockMap(snapshot) ||
      snapshot.size !== 0
    )
      return { didFindLockfile, hasSupportedResolution: false, hasContradiction: true };
    const engines = packageInfo.get("engines");
    if (
      engines !== undefined &&
      (!isLockMap(engines) || [...engines.values()].some((value) => typeof value !== "string"))
    )
      return { didFindLockfile, hasSupportedResolution: false, hasContradiction: true };
    const hasBin = packageInfo.get("hasBin");
    if (hasBin !== undefined && typeof hasBin !== "boolean")
      return { didFindLockfile, hasSupportedResolution: false, hasContradiction: true };
    hasSupportedResolution = true;
  }
  return { didFindLockfile, hasSupportedResolution, hasContradiction: false };
};
