import * as fs from "node:fs";

// A dependency can care both about the resolved kind and about the link
// target, for example when verifying that a build launcher invokes the
// selected dependency. The pooled collectors and verifier share this answer.
export const classifyExistenceAnswer = (absolutePath: string): string => {
  try {
    const lexical = fs.lstatSync(absolutePath);
    if (!lexical.isSymbolicLink()) {
      if (lexical.isFile()) return "file";
      return lexical.isDirectory() ? "dir" : "none";
    }
    const target = fs.realpathSync(absolutePath);
    const stat = fs.statSync(target);
    const kind = stat.isFile() ? "file" : stat.isDirectory() ? "dir" : "none";
    return JSON.stringify(["link", kind, target]);
  } catch {
    return "none";
  }
};
