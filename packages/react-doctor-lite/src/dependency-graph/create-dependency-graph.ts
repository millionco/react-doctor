import { deriveFramework } from "./derive-framework.js";
import { parseDependencyVersion } from "../utils/parse-dependency-version.js";
import type { ParsedVersion } from "../utils/parse-dependency-version.js";
import { splitDependencySpecifier } from "../utils/split-dependency-specifier.js";
import { versionSatisfiesRange } from "../utils/version-satisfies-range.js";
import type { DependencyGraph, PackageNode } from "../types.js";

const collectConcreteVersions = (
  packages: ReadonlyArray<PackageNode>,
  name: string,
): ParsedVersion[] => {
  const versions: ParsedVersion[] = [];
  for (const node of packages) {
    const spec = node.dependencies.get(name);
    const parsed = parseDependencyVersion(spec);
    if (parsed) versions.push(parsed);
  }
  return versions;
};

const lowestVersion = (versions: ReadonlyArray<ParsedVersion>): ParsedVersion | null =>
  versions.reduce<ParsedVersion | null>(
    (lowest, current) => (lowest === null || current.major < lowest.major ? current : lowest),
    null,
  );

// Builds the composable graph query object from a flat list of package nodes.
// This is the single replacement for the bespoke `hasTanStackQuery` /
// `hasPreact` / `parseReactMajor` helpers — every detection becomes a graph
// query.
export const createDependencyGraph = (packages: ReadonlyArray<PackageNode>): DependencyGraph => {
  const isDeclared = (name: string): boolean =>
    packages.some((node) => node.dependencies.has(name));

  return {
    packages,
    framework: deriveFramework(packages),
    hasDependency(specifier: string, range?: string): boolean {
      const split = splitDependencySpecifier(specifier);
      const effectiveRange = range ?? split.range;
      if (!isDeclared(split.name)) return false;
      if (!effectiveRange) return true;
      const lowest = lowestVersion(collectConcreteVersions(packages, split.name));
      return lowest !== null && versionSatisfiesRange(lowest, effectiveRange);
    },
    hasAnyDependency(names: ReadonlyArray<string>): boolean {
      return names.some((name) => isDeclared(name));
    },
    getVersion(name: string): string | null {
      for (const node of packages) {
        const spec = node.dependencies.get(name);
        if (typeof spec === "string") return spec;
      }
      return null;
    },
    getMajor(name: string): number | null {
      return lowestVersion(collectConcreteVersions(packages, name))?.major ?? null;
    },
  };
};
