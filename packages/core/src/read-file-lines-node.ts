import fs from "node:fs";
import path from "node:path";

export const createNodeReadFileLinesSync = (
  rootDirectory: string,
): ((filePath: string) => string[] | null) => {
  return (filePath: string): string[] | null => {
    const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(rootDirectory, filePath);
    try {
      return fs.readFileSync(absolutePath, "utf-8").split("\n");
    } catch {
      return null;
    }
  };
};
