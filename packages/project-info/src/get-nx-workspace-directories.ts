import path from "node:path";
import { isDirectory } from "./utils/is-directory.js";
import { isFile } from "./utils/is-file.js";
import { readDirectoryEntries } from "./utils/read-directory-entries.js";

const NX_PROJECT_DISCOVERY_DIRS = ["apps", "libs", "packages"];

export const getNxWorkspaceDirectories = (rootDirectory: string): string[] => {
  if (!isFile(path.join(rootDirectory, "nx.json"))) return [];

  const collected: string[] = [];
  for (const candidate of NX_PROJECT_DISCOVERY_DIRS) {
    const candidatePath = path.join(rootDirectory, candidate);
    if (!isDirectory(candidatePath)) continue;
    for (const entry of readDirectoryEntries(candidatePath)) {
      if (!entry.isDirectory()) continue;
      const projectDirectory = path.join(candidatePath, entry.name);
      if (
        isFile(path.join(projectDirectory, "project.json")) ||
        isFile(path.join(projectDirectory, "package.json"))
      ) {
        collected.push(`${candidate}/${entry.name}`);
      }
    }
  }
  return collected;
};
