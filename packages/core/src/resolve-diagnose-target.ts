import * as path from "node:path";
import {
  AmbiguousProjectError,
  discoverSupportedSubprojects,
  isFile,
} from "./project-info/index.js";

export interface ResolveDiagnoseTargetOptions {
  readonly allowAmbiguous?: boolean;
}

export const resolveDiagnoseTarget = (
  directory: string,
  options: ResolveDiagnoseTargetOptions = {},
): string | null => {
  if (isFile(path.join(directory, "package.json"))) return directory;

  const subprojects = discoverSupportedSubprojects(directory);
  if (subprojects.length === 0) return null;
  if (subprojects.length === 1) return subprojects[0].directory;

  if (options.allowAmbiguous === true) return null;

  const relativeCandidates = subprojects
    .map((subproject) => path.relative(directory, subproject.directory))
    .toSorted();
  throw new AmbiguousProjectError(directory, relativeCandidates);
};
