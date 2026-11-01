import * as path from "node:path";
import { normalizeFilename } from "./normalize-filename.js";
import type { ClosedJsonSnapshotProject } from "./get-closed-json-snapshot-project.js";

export interface ClosedJsonSnapshotPublicEntryInput {
  readonly project: ClosedJsonSnapshotProject;
  readonly filePath: string;
}

export const isClosedJsonSnapshotPublicEntry = ({
  project,
  filePath,
}: ClosedJsonSnapshotPublicEntryInput): boolean => {
  const normalizedFilePath = normalizeFilename(filePath);
  return project.knownPublicEntryTargets.some((target) => {
    const entryPath = normalizeFilename(path.resolve(project.rootDirectory, target));
    const extension = path.extname(filePath);
    const wildcardIndex = entryPath.indexOf("*");
    if (wildcardIndex !== -1)
      return (
        normalizedFilePath.startsWith(entryPath.slice(0, wildcardIndex)) &&
        normalizedFilePath.endsWith(entryPath.slice(entryPath.lastIndexOf("*") + 1))
      );
    return (
      entryPath === normalizedFilePath ||
      entryPath === normalizedFilePath.slice(0, -extension.length) ||
      (path.basename(normalizedFilePath, extension) === "index" &&
        normalizeFilename(path.dirname(normalizedFilePath)) === entryPath) ||
      project.resolveImport(
        path.join(project.rootDirectory, "package.json"),
        target.startsWith(".") || path.isAbsolute(target) ? target : `./${target}`,
      )?.filePath === normalizedFilePath
    );
  });
};
