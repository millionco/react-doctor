import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { recordExistenceProbe } from "./cross-file-probe-recorder.js";
import { isPathInside } from "./is-path-inside.js";
import {
  haveNoPhysicalPackageCandidates,
  readProviderMember,
} from "./stock-vite-providers/resolve-stock-physical-entry.js";

export interface StockNpmCompilerPackage {
  readonly directory: string;
  readonly name: string;
  readonly version: string;
  readonly memberCount: number;
  readonly contentDigest: string;
  readonly optimizedContentDigest?: string;
  readonly entryMembers: Readonly<Record<string, string>>;
}
export interface StockNpmCompilerProfile {
  readonly packages: readonly StockNpmCompilerPackage[];
  readonly edges: readonly {
    readonly issuer: string;
    readonly specifier: string;
    readonly target: string;
  }[];
  readonly missing: readonly { readonly issuer: string; readonly specifier: string }[];
}

const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const readManifest = (directory: string): Record<string, unknown> | null => {
  const bytes = readProviderMember(path.join(directory, "package.json"));
  return bytes ? object(JSON.parse(bytes.toString("utf8"))) : null;
};
const stat = (filename: string): fs.Stats | undefined => {
  recordExistenceProbe(filename);
  return fs.lstatSync(filename, { throwIfNoEntry: false });
};
// Close the regular npm package layout, including extensionless require
// shadows and nested package candidates. No package code is loaded.
const packageCandidate = (issuer: string, name: string): string | null => {
  for (let directory = issuer; ; directory = path.dirname(directory)) {
    const candidate = path.join(directory, "node_modules", name);
    for (const extension of [".js", ".json", ".node"]) {
      if (stat(candidate + extension)) return null;
    }
    const info = stat(candidate);
    if (info)
      return info.isDirectory() && fs.realpathSync(candidate) === candidate ? candidate : null;
    if (path.dirname(directory) === directory) return null;
  }
};
const verifyPackage = (
  root: string,
  profile: StockNpmCompilerPackage,
  expectedPackages: ReadonlySet<string>,
): boolean => {
  const directory = path.join(root, profile.directory);
  if (fs.realpathSync(directory) !== directory || !stat(directory)?.isDirectory()) return false;
  const discovered: Array<[string, number, string]> = [];
  const pending = [directory];
  while (pending.length) {
    const current = pending.pop()!;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const filename = path.join(current, entry.name);
      if (entry.isSymbolicLink()) return false;
      if (entry.isDirectory()) {
        if (current === directory && entry.name === "node_modules") {
          if (![...expectedPackages].some((candidate) => isPathInside(candidate, filename)))
            return false;
          continue;
        }
        pending.push(filename);
      } else if (entry.isFile()) {
        const member = path.relative(directory, filename).split(path.sep).join("/");
        const bytes = readProviderMember(filename);
        if (!bytes) return false;
        discovered.push([member, bytes.length, createHash("sha256").update(bytes).digest("hex")]);
      } else return false;
    }
  }
  discovered.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  if (discovered.length !== profile.memberCount) return false;
  const digest = createHash("sha256").update(JSON.stringify(discovered)).digest("hex");
  if (digest !== profile.contentDigest && digest !== profile.optimizedContentDigest) return false;
  const manifest = readManifest(directory);
  return manifest?.name === profile.name && manifest.version === profile.version;
};

export const verifyStockNpmCompilerPackages = (
  root: string,
  profile: StockNpmCompilerProfile,
): boolean => {
  const expectedPackages = new Set(profile.packages.map((item) => path.join(root, item.directory)));
  for (const packageProfile of profile.packages)
    if (!verifyPackage(root, packageProfile, expectedPackages)) return false;
  for (const edge of profile.edges) {
    if (
      packageCandidate(path.join(root, edge.issuer), edge.specifier) !==
      path.join(root, edge.target)
    )
      return false;
  }
  for (const missing of profile.missing) {
    if (!haveNoPhysicalPackageCandidates([path.join(root, missing.issuer)], missing.specifier))
      return false;
  }
  return true;
};
