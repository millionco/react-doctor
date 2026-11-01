import * as path from "node:path";
import type { ClosedJsonSnapshotProject } from "./get-closed-json-snapshot-project.js";

export interface ClosedJsonSnapshotPublicEntryInput {
  readonly project: ClosedJsonSnapshotProject;
  readonly filePath: string;
}

export const isClosedJsonSnapshotPublicEntry = ({
  project,
  filePath,
}: ClosedJsonSnapshotPublicEntryInput): boolean =>
  project.knownPublicEntryTargets.some((target) => {
    const entryPath = path.resolve(project.rootDirectory, target);
    const extension = path.extname(filePath);
    const wildcardIndex = entryPath.indexOf("*");
    if (wildcardIndex !== -1)
      return (
        filePath.startsWith(entryPath.slice(0, wildcardIndex)) &&
        filePath.endsWith(entryPath.slice(entryPath.lastIndexOf("*") + 1))
      );
    return (
      entryPath === filePath ||
      entryPath === filePath.slice(0, -extension.length) ||
      (path.basename(filePath, extension) === "index" && path.dirname(filePath) === entryPath) ||
      project.resolveImport(
        path.join(project.rootDirectory, "package.json"),
        target.startsWith(".") || path.isAbsolute(target) ? target : `./${target}`,
      )?.filePath === filePath
    );
  });
