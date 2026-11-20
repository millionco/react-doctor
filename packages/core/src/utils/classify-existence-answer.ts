import * as fs from "node:fs";
import { createHash } from "node:crypto";

// Keep the target's kind for resolvers that follow links, and distinguish a
// link from an ordinary path for resolution proofs that require the latter.
export const classifyExistenceAnswer = (absolutePath: string): string => {
  try {
    const entry = fs.lstatSync(absolutePath, { throwIfNoEntry: false });
    if (!entry) return "none";
    if (entry.isSymbolicLink()) {
      const target = fs.statSync(absolutePath, { throwIfNoEntry: false });
      const kind = target?.isFile() ? "file" : target?.isDirectory() ? "dir" : "none";
      const link = createHash("sha1").update(fs.readlinkSync(absolutePath)).digest("hex");
      return `symlink:${kind}:${link}`;
    }
    if (entry.isFile()) return "file";
    if (entry.isDirectory()) return "dir";
    return "unsupported";
  } catch {
    return "unsupported";
  }
};
