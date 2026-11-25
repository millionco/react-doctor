import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import * as path from "node:path";
import { recordContentProbe, recordExistenceProbe } from "../cross-file-probe-recorder.js";
import { isPathInside } from "../is-path-inside.js";

// node-* models the stock Node 24 conditions with require(ESM) enabled.
export type StockProviderProfile =
  | "node-require"
  | "node-import"
  | "vite-production-import"
  | "vite-production-require"
  | "vite-style"
  | "jest-browser";

export interface StockPackageContract {
  readonly packageName: string;
  readonly version: string;
  // Trusted public package data supplied by the rule, independent of the
  // project's lockfile. Include the manifest, selected entry and any other
  // package members the caller's semantic provider proof actually uses.
  readonly files: Readonly<Record<string, string>>;
}

export interface StockPhysicalProviderRequest {
  readonly projectRoot: string;
  readonly importerDirectory: string;
  readonly specifier: string;
  readonly profile: StockProviderProfile;
  readonly contract: StockPackageContract;
}

export interface StockPhysicalEntry {
  readonly packageDirectory: string;
  readonly entry: string;
}

const CONDITIONS: Readonly<Record<StockProviderProfile, readonly string[]>> = {
  "node-require": ["node", "require", "node-addons", "module-sync"],
  "node-import": ["node", "import", "node-addons", "module-sync"],
  "vite-production-import": ["module", "browser", "production", "import"],
  "vite-production-require": ["module", "browser", "production", "require"],
  "vite-style": ["style", "production", "import"],
  "jest-browser": ["browser", "require"],
};
const EXCLUDED_STOCK_CONDITIONS = new Set([
  "module",
  "browser",
  "production",
  "development",
  "node",
  "node-addons",
  "import",
  "require",
  "style",
  "sass",
  "types",
  "react-server",
  "module-sync",
]);
const barePackage = /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/u;
const safeMember = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/u;
const maxMemberBytes = 24_000_000;

const asObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const isMemberPath = (name: string): boolean =>
  safeMember.test(name) &&
  name
    .split("/")
    .every((segment) => segment !== "." && segment !== ".." && segment !== "node_modules");

export const readProviderMember = (file: string, digest?: string): Buffer | null => {
  recordExistenceProbe(file);

  if (realpathSync(file) !== file) return null;
  recordContentProbe(file);
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.size > BigInt(maxMemberBytes)) return null;
    const bytes = readFileSync(fd);
    const after = fstatSync(fd, { bigint: true });
    const named = lstatSync(file, { bigint: true });
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs ||
      named.dev !== after.dev ||
      named.ino !== after.ino ||
      named.size !== after.size ||
      named.mtimeNs !== after.mtimeNs ||
      named.ctimeNs !== after.ctimeNs ||
      BigInt(bytes.length) !== after.size
    )
      return null;
    return digest === undefined || createHash("sha256").update(bytes).digest("hex") === digest
      ? bytes
      : null;
  } finally {
    closeSync(fd);
  }
};

const NOT_APPLICABLE = Symbol("no matching condition");
const chooseConditionalTarget = (
  value: unknown,
  active: readonly string[],
): string | null | typeof NOT_APPLICABLE => {
  if (typeof value === "string") return value;
  const alternatives = asObject(value);
  if (!alternatives) return null;
  for (const [condition, target] of Object.entries(alternatives)) {
    // Unmodeled conditions and array fallbacks need a separate
    // resolver contract before this reader can make any claim about them.
    if (condition !== "default" && !EXCLUDED_STOCK_CONDITIONS.has(condition)) return null;
    if (condition !== "default" && !active.includes(condition)) continue;
    const selected = chooseConditionalTarget(target, active);
    if (selected !== NOT_APPLICABLE) return selected;
  }
  return NOT_APPLICABLE;
};

const selectExport = (
  exportsField: unknown,
  subpath: string,
  active: readonly string[],
): string | null => {
  const map = asObject(exportsField);
  const names = Object.keys(map ?? {});
  const subpathMap = names.some((name) => name.startsWith("."));
  if (!subpathMap) {
    if (subpath !== ".") return null;
    const target = chooseConditionalTarget(exportsField, active);
    return typeof target === "string" && target.startsWith("./") ? target.slice(2) : null;
  }
  if (!map || names.some((name) => name !== "." && !name.startsWith("./"))) return null;
  if (Object.hasOwn(map, subpath)) {
    const target = chooseConditionalTarget(map[subpath], active);
    return typeof target === "string" && target.startsWith("./") ? target.slice(2) : null;
  }
  if (
    subpath.startsWith("./") &&
    map["./*"] === "./*" &&
    names.every((name) => !name.includes("*") || name === "./*")
  )
    return subpath.slice(2);
  return null;
};

const selectStockMember = (
  manifest: Record<string, unknown>,
  subpath: string,
  specifier: string,
  profile: StockProviderProfile,
): string | null => {
  const viteBrowser = profile === "vite-production-import" || profile === "vite-production-require";
  let target: unknown;
  if (manifest.exports !== undefined && manifest.exports !== null) {
    target = selectExport(manifest.exports, subpath, CONDITIONS[profile]);
  } else if (subpath !== ".") {
    target = subpath.slice(2);
  } else if (profile === "vite-style") {
    target = manifest.style ?? manifest.main;
  } else if (viteBrowser) {
    target =
      (typeof manifest.browser === "string" ? manifest.browser : null) ??
      manifest.module ??
      manifest["jsnext:main"] ??
      manifest.jsnext ??
      manifest.main ??
      "index.js";
  } else {
    target = manifest.main ?? "index.js";
  }
  if (typeof target !== "string") return null;
  const member = target.startsWith("./") ? target.slice(2) : target;
  if (!isMemberPath(member)) return null;
  if (viteBrowser) {
    const browser = asObject(manifest.browser);
    const potentialRewrite = (name: string): string =>
      name.replace(/^\.\//u, "").replace(/\.(?:[cm]?[jt]sx?|json)$/u, "");
    if (
      browser &&
      Object.keys(browser).some(
        (key) => key === specifier || potentialRewrite(key) === potentialRewrite(member),
      )
    )
      return null;
  }
  return member;
};

const readIssuerPackageScope = (
  root: string,
  issuer: string,
): { directory: string; manifest: Record<string, unknown> } | null => {
  for (let current = issuer; isPathInside(current, root); current = path.dirname(current)) {
    if (path.basename(current) === "node_modules") return null;
    const manifestPath = path.join(current, "package.json");
    recordExistenceProbe(manifestPath);
    if (lstatSync(manifestPath, { throwIfNoEntry: false })) {
      const bytes = readProviderMember(manifestPath);
      const manifest = bytes && asObject(JSON.parse(bytes.toString("utf8")));
      return manifest ? { directory: current, manifest } : null;
    }
    if (current === root) break;
  }
  return null;
};

const COMMON_JS_FILE_SUFFIXES = [".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".json", ".node"];

// A viable node_modules/name.js (or a Jest extension variant) can win
// before a farther provider directory. Reject rather than model these paths.
const hasBareRequestFileCandidate = (candidate: string): boolean =>
  COMMON_JS_FILE_SUFFIXES.some((extension) => {
    const alternate = candidate + extension;
    recordExistenceProbe(alternate);
    return lstatSync(alternate, { throwIfNoEntry: false }) !== undefined;
  });

const findPackageDirectory = (
  projectRoot: string,
  importerDirectory: string,
  packageName: string,
  rejectFileCandidates: boolean,
): string | null => {
  for (
    let current = importerDirectory;
    isPathInside(current, projectRoot);
    current = path.dirname(current)
  ) {
    // Stock Node node_modules paths avoid treating node_modules itself as
    // an issuer directory. The .pnpm directory above it remains in the walk.
    if (path.basename(current) !== "node_modules") {
      const candidate = path.join(current, "node_modules", packageName);
      recordExistenceProbe(candidate);
      const entry = lstatSync(candidate, { throwIfNoEntry: false });
      if (rejectFileCandidates && hasBareRequestFileCandidate(candidate)) return null;
      if (entry) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) return null;

        const real = realpathSync(candidate);
        recordExistenceProbe(real);
        if (
          !isPathInside(real, path.join(projectRoot, "node_modules")) ||
          !lstatSync(real).isDirectory()
        )
          return null;
        return real;
      }
    }
    if (current === projectRoot) break;
  }
  return null;
};

/**
 * Read one installed provider from explicitly selected stock resolver
 * conditions. The caller must qualify those conditions, compiler/config
 * transforms and the ordinary resolver graph before treating this receipt as
 * runtime evidence. Unknown roots and package shapes fail closed.
 */
export const resolveStockPhysicalEntry = (
  request: StockPhysicalProviderRequest,
): StockPhysicalEntry | null => {
  const { projectRoot, importerDirectory, specifier, profile, contract } = request;
  if (
    !path.isAbsolute(projectRoot) ||
    !path.isAbsolute(importerDirectory) ||
    !Object.hasOwn(CONDITIONS, profile) ||
    !isPathInside(importerDirectory, projectRoot) ||
    !barePackage.test(contract.packageName) ||
    contract.packageName
      .split("/")
      .some((name) => name === "." || name === ".." || name === "node_modules") ||
    (specifier !== contract.packageName && !specifier.startsWith(contract.packageName + "/")) ||
    !Object.hasOwn(contract.files, "package.json")
  )
    return null;
  const subpath = "." + specifier.slice(contract.packageName.length);
  if (subpath !== "." && !isMemberPath(subpath.slice(2))) return null;
  recordExistenceProbe(projectRoot);

  recordExistenceProbe(importerDirectory);

  try {
    const root = realpathSync(projectRoot);
    const issuer = realpathSync(importerDirectory);
    if (!isPathInside(issuer, root) || !lstatSync(issuer).isDirectory()) return null;
    const scope = readIssuerPackageScope(root, issuer);
    if (!scope) return null;
    const self =
      scope.manifest.name === contract.packageName &&
      scope.manifest.exports !== undefined &&
      scope.manifest.exports !== null;
    const rejectFileCandidates = profile === "node-require" || profile === "jest-browser";
    const directory = self
      ? scope.directory
      : findPackageDirectory(root, issuer, contract.packageName, rejectFileCandidates);
    if (!directory || !isPathInside(directory, path.join(root, "node_modules"))) return null;
    const bytes = readProviderMember(
      path.join(directory, "package.json"),
      contract.files["package.json"]!,
    );
    if (!bytes) return null;
    const manifest = asObject(JSON.parse(bytes.toString("utf8")));
    if (
      !manifest ||
      manifest.name !== contract.packageName ||
      manifest.version !== contract.version
    )
      return null;
    const choice = selectStockMember(manifest, subpath, specifier, profile);
    if (!choice || !Object.hasOwn(contract.files, choice)) return null;
    for (const [member, digest] of Object.entries(contract.files)) {
      if (member === "package.json") continue;
      if (!isMemberPath(member) || !readProviderMember(path.join(directory, member), digest))
        return null;
    }
    return { packageDirectory: directory, entry: path.join(directory, choice) };
  } catch {
    return null;
  }
};

// Vite's stock Sass loader checks the project and then the Vite package
// directory. This broader absence query refuses any visible package candidate
// on either ancestor chain, even a malformed or dangling one.
export const haveNoPhysicalPackageCandidates = (
  importerDirectories: readonly string[],
  packageName: string,
): boolean => {
  if (
    !importerDirectories.length ||
    !barePackage.test(packageName) ||
    packageName.split("/").some((name) => name === "." || name === ".." || name === "node_modules")
  )
    return false;
  const seen = new Set<string>();
  try {
    for (const issuer of importerDirectories) {
      if (!path.isAbsolute(issuer)) return false;
      recordExistenceProbe(issuer);

      for (let current = realpathSync(issuer); ; current = path.dirname(current)) {
        if (seen.has(current)) break;
        seen.add(current);
        const candidate = path.join(current, "node_modules", packageName);
        recordExistenceProbe(candidate);
        if (
          lstatSync(candidate, { throwIfNoEntry: false }) ||
          hasBareRequestFileCandidate(candidate)
        )
          return false;
        if (path.dirname(current) === current) break;
      }
    }
    return true;
  } catch {
    return false;
  }
};
