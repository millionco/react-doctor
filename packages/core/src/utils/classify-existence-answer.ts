import * as fs from "node:fs";

// The existence class a module-resolution candidate probe sees: `"file"`,
// `"dir"`, or `"none"` (missing or an exotic entry — `statSync` follows
// symlinks, matching the resolvers). Shared by the sidecar probe answer
// resolver (verify time) and the pooled probe collectors (store time) so
// both sides classify a path identically.
export const classifyExistenceAnswer = (absolutePath: string): string => {
  try {
    const stat = fs.statSync(absolutePath);
    return stat.isFile() ? "file" : stat.isDirectory() ? "dir" : "none";
  } catch {
    return "none";
  }
};
