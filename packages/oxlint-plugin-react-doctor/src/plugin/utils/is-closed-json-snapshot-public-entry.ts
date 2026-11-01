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
}: ClosedJsonSnapshotPublicEntryInput): boolean =>
  project.knownPublicEntryTargets.some((target) => {
    const entryPath = path.resolve(project.rootDirectory, target);
    const comparableEntryPath = normalizeFilename(entryPath).toLowerCase();
    const comparableFilePath = normalizeFilename(filePath).toLowerCase();
    const extension = path.extname(comparableFilePath);
    const wildcardIndex = comparableEntryPath.indexOf("*");
    if (wildcardIndex !== -1)
      return (
        comparableFilePath.startsWith(comparableEntryPath.slice(0, wildcardIndex)) &&
        comparableFilePath.endsWith(
          comparableEntryPath.slice(comparableEntryPath.lastIndexOf("*") + 1),
        )
      );
    return (
      comparableEntryPath === comparableFilePath ||
      comparableEntryPath === comparableFilePath.slice(0, -extension.length) ||
      (path.basename(comparableFilePath, extension) === "index" &&
        normalizeFilename(path.dirname(comparableFilePath)).toLowerCase() ===
          comparableEntryPath) ||
      project.sourceResolutionPolicy.extensions.some(
        (configuredExtension) =>
          comparableFilePath === `${comparableEntryPath}${configuredExtension.toLowerCase()}` ||
          comparableFilePath ===
            normalizeFilename(path.join(entryPath, `index${configuredExtension}`)).toLowerCase(),
      ) ||
      normalizeFilename(
        project.resolveImport(
          path.join(project.rootDirectory, "package.json"),
          target.startsWith(".") || path.isAbsolute(target) ? target : `./${target}`,
        )?.filePath ?? "",
      ).toLowerCase() === comparableFilePath
    );
  });
