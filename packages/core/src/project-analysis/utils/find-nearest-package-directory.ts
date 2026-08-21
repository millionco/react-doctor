import { existsSync } from "node:fs";
import { dirname, parse, resolve } from "node:path";

export const findNearestPackageDirectory = (filePath: string): string | undefined => {
  let currentDirectory = dirname(resolve(filePath));
  const rootDirectory = parse(currentDirectory).root;
  while (true) {
    if (existsSync(resolve(currentDirectory, "package.json"))) return currentDirectory;
    if (currentDirectory === rootDirectory) return undefined;
    currentDirectory = dirname(currentDirectory);
  }
};
