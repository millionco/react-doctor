import fs from "node:fs";
import path from "node:path";
import { isFile } from "./is-file.js";

const NX_PROJECT_DISCOVERY_DIRS = ["apps", "libs", "packages"];

export const getNxWorkspaceDirectories = (rootDirectory: string): string[] => {
  if (!isFile(path.join(rootDirectory, "nx.json"))) return [];

  const collected: string[] = [];
  for (const candidate of NX_PROJECT_DISCOVERY_DIRS) {
    const candidatePath = path.join(rootDirectory, candidate);
    if (!fs.existsSync(candidatePath) || !fs.statSync(candidatePath).isDirectory()) continue;
    for (const entry of fs.readdirSync(candidatePath, { withFileTypes: true })) {
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
