import * as path from "node:path";
import { createDependencyGraph } from "./create-dependency-graph.js";
import { expandWorkspaceGlob } from "./expand-workspace-glob.js";
import { findMonorepoRoot } from "./find-monorepo-root.js";
import { readPackageJson } from "./read-package-json.js";
import { readWorkspaceGlobs } from "./read-workspace-globs.js";
import { mergeDependencySections } from "../utils/merge-dependency-sections.js";
import type { DependencyGraph, DependencyManifest, PackageNode } from "../types.js";

const toPackageNode = (
  directory: string,
  manifest: DependencyManifest,
  isRoot: boolean,
): PackageNode => ({
  name: manifest.name ?? path.basename(directory),
  directory,
  isRoot,
  dependencies: mergeDependencySections(manifest),
});

// In-memory mode: build a graph straight from a caller-supplied manifest. No
// filesystem access, so evals never have to inflate a fake `package.json`.
export const buildDependencyGraphFromManifest = (manifest: DependencyManifest): DependencyGraph =>
  createDependencyGraph([toPackageNode("", manifest, true)]);

// Disk mode: discover the enclosing workspace root, read it plus every
// workspace package, and expose the whole graph. Replaces the climbing /
// catalog-resolving / workspace-walking logic of `discover-project.ts` with a
// single flat list of nodes.
export const buildDependencyGraphFromDisk = (cwd: string): DependencyGraph => {
  const rootDirectory = findMonorepoRoot(cwd);
  const seenDirectories = new Set<string>();
  const nodes: PackageNode[] = [];

  const addNode = (directory: string, isRoot: boolean): void => {
    const resolved = path.resolve(directory);
    if (seenDirectories.has(resolved)) return;
    const manifest = readPackageJson(resolved);
    if (!manifest) return;
    seenDirectories.add(resolved);
    nodes.push(toPackageNode(resolved, manifest, isRoot));
  };

  const rootManifest = readPackageJson(rootDirectory);
  addNode(rootDirectory, true);

  for (const glob of readWorkspaceGlobs(rootDirectory, rootManifest)) {
    for (const packageDirectory of expandWorkspaceGlob(rootDirectory, glob)) {
      addNode(packageDirectory, false);
    }
  }

  // Guarantee the scanned directory is represented even when it is neither the
  // root nor matched by a workspace glob.
  addNode(cwd, false);

  return createDependencyGraph(nodes);
};
