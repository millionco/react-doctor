import * as fs from "node:fs";
import * as path from "node:path";

export interface CollectProfilePathsInput {
  directory: string;
  extension: string;
}

export const collectProfilePaths = (input: CollectProfilePathsInput): string[] => {
  const profilePaths: string[] = [];
  const pendingDirectories = [input.directory];
  while (pendingDirectories.length > 0) {
    const currentDirectory = pendingDirectories.pop();
    if (currentDirectory === undefined) continue;
    for (const entry of fs.readdirSync(currentDirectory, { withFileTypes: true })) {
      const entryPath = path.join(currentDirectory, entry.name);
      if (entry.isDirectory()) pendingDirectories.push(entryPath);
      else if (entry.isFile() && entry.name.endsWith(input.extension)) {
        profilePaths.push(entryPath);
      }
    }
  }
  return profilePaths.toSorted();
};
