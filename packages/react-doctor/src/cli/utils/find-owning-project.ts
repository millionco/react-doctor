import * as path from "node:path";
import {
  buildPackageGraph,
  discoverReactSubprojects,
  isFile,
  readPackageJson,
} from "../../core/core-project-discovery.js";

export const findOwningProjectDirectory = (rootDirectory: string, filePath: string): string => {
  const absoluteFilePath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(rootDirectory, filePath);
  const packageJsonPath = path.join(rootDirectory, "package.json");
  if (isFile(packageJsonPath)) {
    const packageGraph = buildPackageGraph(rootDirectory, readPackageJson(packageJsonPath));
    if (packageGraph.workspacePatterns.length > 0) {
      const owningPackage = packageGraph.findOwningPackage(
        absoluteFilePath,
        (packageNode) => packageNode.hasReactDependency,
      );
      if (owningPackage) {
        return owningPackage.isRoot ? rootDirectory : owningPackage.directory;
      }
      if (packageGraph.packages.some((packageNode) => packageNode.hasReactDependency)) {
        return rootDirectory;
      }
    }
  }

  const candidates = discoverReactSubprojects(rootDirectory);
  if (candidates.length === 0) return rootDirectory;

  let bestMatch: { directory: string; depth: number } | null = null;
  for (const candidate of candidates) {
    const candidateDirectory = path.resolve(candidate.directory);
    const relativeFromCandidate = path.relative(candidateDirectory, absoluteFilePath);
    if (relativeFromCandidate.startsWith("..") || path.isAbsolute(relativeFromCandidate)) continue;
    const depth = candidateDirectory.length;
    if (!bestMatch || depth > bestMatch.depth) {
      bestMatch = { directory: candidate.directory, depth };
    }
  }

  return bestMatch ? bestMatch.directory : rootDirectory;
};
