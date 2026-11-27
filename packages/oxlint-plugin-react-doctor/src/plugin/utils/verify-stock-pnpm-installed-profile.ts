import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  recordDirectoryProbe,
  recordExistenceProbe,
  recordRealpathProbe,
} from "./cross-file-probe-recorder.js";
import { readProviderMember } from "./stock-vite-providers/resolve-stock-physical-entry.js";

interface PackageContent {
  readonly name: string;
  readonly version: string;
  readonly memberCount: number;
  readonly digest: string;
  readonly dependencies: Readonly<Record<string, string>>;
}

interface AdditionalDependencyEdge {
  readonly issuer: string;
  readonly specifier: string;
  readonly target: string;
}

export interface StockPnpmInstalledProfile {
  readonly format: 1;
  readonly roots: Readonly<Record<string, string>>;
  readonly generatedBins?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly packages: Readonly<Record<string, PackageContent>>;
  readonly effectiveExtraIssuerEdges: readonly AdditionalDependencyEdge[];
  readonly runtimeRootSpecifiers: readonly string[];
}

export interface StockPnpmInstalledClosure {
  readonly packageDirectories: ReadonlyMap<string, string>;
  readonly hasRuntimeRootSpecifier: (specifier: string, issuer: string) => boolean;
}

const packageName = /^(?:@[a-zA-Z0-9_.-]+\/)?[a-zA-Z0-9_.-]+$/u;
const relativeInside = (root: string, entry: string): boolean => {
  const relative = path.relative(root, entry);
  return relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative);
};
const lookupExtensions = [".js", ".json", ".node", ".mjs", ".cjs", ".ts", ".tsx", ".jsx"];

const readPackageAtIssuer = (root: string, issuer: string, specifier: string): string | null => {
  if (
    !packageName.test(specifier) ||
    specifier.split("/").some((name) => name === "." || name === "..") ||
    !relativeInside(root, issuer)
  )
    return null;
  for (
    let directory = issuer;
    relativeInside(root, directory);
    directory = path.dirname(directory)
  ) {
    if (path.basename(directory) !== "node_modules") {
      const candidate = path.join(directory, "node_modules", specifier);
      recordExistenceProbe(candidate);
      recordRealpathProbe(candidate);
      for (const extension of lookupExtensions) {
        recordExistenceProbe(candidate + extension);
        if (fs.lstatSync(candidate + extension, { throwIfNoEntry: false })) return null;
      }
      const entry = fs.lstatSync(candidate, { throwIfNoEntry: false });
      if (entry) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) return null;
        const physical = fs.realpathSync(candidate);
        if (
          !relativeInside(path.join(root, "node_modules"), physical) ||
          !fs.lstatSync(physical).isDirectory()
        )
          return null;
        return physical;
      }
    }
    if (directory === root) break;
  }
  return null;
};

const PACKAGE_BIN_PROJECT_ROOT = "/__react_doctor_project_root__/";

const hasVerifiedPackageLocalBins = (
  root: string,
  modules: string,
  expected: Readonly<Record<string, string>> | undefined,
): boolean => {
  if (!expected) return false;
  recordDirectoryProbe(modules);
  const children = fs.readdirSync(modules, { withFileTypes: true });
  if (children.length !== 1 || children[0]?.name !== ".bin" || !children[0].isDirectory())
    return false;
  const directory = path.join(modules, ".bin");
  recordDirectoryProbe(directory);
  const shims = fs.readdirSync(directory, { withFileTypes: true });
  if (shims.length !== Object.keys(expected).length) return false;
  return shims.every((shim) => {
    if (!shim.isFile() || !Object.hasOwn(expected, shim.name)) return false;
    const filename = path.join(directory, shim.name);
    if ((fs.statSync(filename).mode & 0o111) === 0) return false;
    const contents = readProviderMember(filename);
    if (!contents || contents.length > 16_384) return false;
    const source = contents.toString("utf8");
    if (source.includes(PACKAGE_BIN_PROJECT_ROOT)) return false;
    const canonical = source.replaceAll(root + "/", PACKAGE_BIN_PROJECT_ROOT);
    return createHash("sha256").update(canonical).digest("hex") === expected[shim.name];
  });
};

const verifyPackageContent = (
  root: string,
  directory: string,
  expected: PackageContent,
  generatedBins: Readonly<Record<string, string>> | undefined,
): boolean => {
  let manifest: unknown;
  const pending = [directory];
  const members: Array<[string, number, string]> = [];
  while (pending.length > 0) {
    const current = pending.pop()!;
    recordDirectoryProbe(current);
    for (const leaf of fs.readdirSync(current, { withFileTypes: true })) {
      const filename = path.join(current, leaf.name);
      if (leaf.isDirectory()) {
        if (leaf.name === "node_modules") {
          if (current !== directory || !hasVerifiedPackageLocalBins(root, filename, generatedBins))
            return false;
          continue;
        }
        pending.push(filename);
      } else {
        if (!leaf.isFile()) return false;
        const contents = readProviderMember(filename);
        if (!contents) return false;
        const relative = path.relative(directory, filename).split(path.sep).join("/");
        members.push([
          relative,
          contents.length,
          createHash("sha256").update(contents).digest("hex"),
        ]);
        if (relative === "package.json") manifest = JSON.parse(contents.toString("utf8"));
        if (members.length > expected.memberCount) return false;
      }
    }
  }
  if (members.length !== expected.memberCount) return false;
  members.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  const digest = createHash("sha256").update(JSON.stringify(members)).digest("hex");
  return (
    digest === expected.digest &&
    manifest !== null &&
    typeof manifest === "object" &&
    "name" in manifest &&
    manifest.name === expected.name &&
    "version" in manifest &&
    manifest.version === expected.version
  );
};

export const verifyStockPnpmInstalledProfile = (
  root: string,
  profile: StockPnpmInstalledProfile,
): StockPnpmInstalledClosure | null => {
  try {
    if (!path.isAbsolute(root) || fs.realpathSync(root) !== root || profile.format !== 1)
      return null;
    const directories = new Map<string, string>();
    const owners = new Map<string, string>();
    const queue: Array<{ key: string; directory: string }> = [];
    const add = (issuer: string, name: string, key: string): boolean => {
      const expected = Object.hasOwn(profile.packages, key) ? profile.packages[key] : undefined;
      if (!expected || expected.name !== name) return false;
      const actual = readPackageAtIssuer(root, issuer, name);
      if (!actual) return false;
      const existing = directories.get(key);
      if (existing !== undefined) return existing === actual;
      if (owners.has(actual)) return false;
      directories.set(key, actual);
      owners.set(actual, key);
      queue.push({ key, directory: actual });
      return true;
    };
    for (const [name, key] of Object.entries(profile.roots)) {
      if (!add(root, name, key)) return null;
    }
    const extra = new Map<string, AdditionalDependencyEdge[]>();
    for (const edge of profile.effectiveExtraIssuerEdges) {
      const records = extra.get(edge.issuer) ?? [];
      records.push(edge);
      extra.set(edge.issuer, records);
    }
    for (const { key, directory } of queue) {
      const expected = profile.packages[key];
      if (!verifyPackageContent(root, directory, expected, profile.generatedBins?.[key]))
        return null;
      for (const [name, target] of Object.entries(expected.dependencies)) {
        if (!add(directory, name, target)) return null;
      }
      for (const edge of extra.get(key) ?? []) {
        if (!add(directory, edge.specifier, edge.target)) return null;
      }
    }
    if (directories.size !== Object.keys(profile.packages).length) return null;
    const supportedSpecifiers = new Set(profile.runtimeRootSpecifiers);
    const hasRuntimeRootSpecifier = (specifier: string, issuer: string): boolean => {
      if (!supportedSpecifiers.has(specifier)) return false;
      const parts = specifier.split("/");
      const name = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
      const key = name && Object.hasOwn(profile.roots, name) ? profile.roots[name] : undefined;
      if (!key) return false;
      return readPackageAtIssuer(root, path.dirname(issuer), name) === directories.get(key);
    };
    return { packageDirectories: directories, hasRuntimeRootSpecifier };
  } catch {
    return null;
  }
};
