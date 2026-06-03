import * as path from "node:path";
import { AmbiguousProjectError, discoverReactSubprojects, isFile } from "./project-info/index.js";

export interface ResolveDiagnoseTargetOptions {
  readonly allowAmbiguous?: boolean;
}

export const resolveDiagnoseTarget = (
  directory: string,
  options: ResolveDiagnoseTargetOptions = {},
): string | null => {
  if (isFile(path.join(directory, "package.json"))) return directory;

  const reactSubprojects = discoverReactSubprojects(directory);
  if (reactSubprojects.length === 0) return null;
  if (reactSubprojects.length === 1) return reactSubprojects[0].directory;

  if (options.allowAmbiguous === true) return null;

  const relativeCandidates = reactSubprojects
    .map((subproject) => path.relative(directory, subproject.directory))
    .toSorted();
  throw new AmbiguousProjectError(directory, relativeCandidates);
};
