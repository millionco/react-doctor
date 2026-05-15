import path from "node:path";
import { discoverReactSubprojects, listWorkspacePackages } from "../core/discover-project.js";

export const findOwningProjectDirectory = (rootDirectory: string, filePath: string): string => {
  const absoluteFile = path.isAbsolute(filePath) ? filePath : path.resolve(rootDirectory, filePath);

  const workspacePackages = listWorkspacePackages(rootDirectory);
  const candidates =
    workspacePackages.length > 0 ? workspacePackages : discoverReactSubprojects(rootDirectory);
  if (candidates.length === 0) return rootDirectory;

  let bestMatch: { directory: string; depth: number } | null = null;
  for (const candidate of candidates) {
    const candidateDirectory = path.resolve(candidate.directory);
    const relativeFromCandidate = path.relative(candidateDirectory, absoluteFile);
    if (relativeFromCandidate.startsWith("..") || path.isAbsolute(relativeFromCandidate)) continue;
    const depth = candidateDirectory.length;
    if (!bestMatch || depth > bestMatch.depth) {
      bestMatch = { directory: candidate.directory, depth };
    }
  }

  return bestMatch ? bestMatch.directory : rootDirectory;
};
