import * as fs from "node:fs";
import * as path from "node:path";
import { SNAPSHOT_CONFIG_MAX_BYTES, SNAPSHOT_CONFIG_MAX_DEPTH } from "./constants.js";

export interface ClosedJsonSnapshotCommonjsScopeInput {
  readonly rootDirectory: string;
  readonly filePath: string;
}

export const hasClosedJsonSnapshotCommonjsScope = ({
  rootDirectory,
  filePath,
}: ClosedJsonSnapshotCommonjsScopeInput): boolean => {
  const root = path.resolve(rootDirectory);
  let directory = path.dirname(path.resolve(filePath));
  try {
    for (let depth = 0; depth < SNAPSHOT_CONFIG_MAX_DEPTH; depth += 1) {
      const relative = path.relative(root, directory);
      if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
        return false;
      const manifestPath = path.join(directory, "package.json");
      const status = fs.lstatSync(manifestPath, { throwIfNoEntry: false });
      if (status) {
        if (!status.isFile() || status.isSymbolicLink() || status.size > SNAPSHOT_CONFIG_MAX_BYTES)
          return false;
        const metadata: unknown = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
        return !("type" in metadata) || metadata.type === "commonjs";
      }
      if (directory === root) return true;
      directory = path.dirname(directory);
    }
    return false;
  } catch {
    return false;
  }
};
