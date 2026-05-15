import path from "node:path";
import { AmbiguousProjectError } from "../errors.js";
import { discoverReactSubprojects } from "./discover-project.js";
import { isFile } from "./is-file.js";

export const resolveDiagnoseTarget = (directory: string): string | null => {
  if (isFile(path.join(directory, "package.json"))) return directory;

  const reactSubprojects = discoverReactSubprojects(directory);
  if (reactSubprojects.length === 0) return null;
  if (reactSubprojects.length === 1) return reactSubprojects[0].directory;

  const relativeCandidates = reactSubprojects
    .map((subproject) => path.relative(directory, subproject.directory))
    .toSorted();
  throw new AmbiguousProjectError(directory, relativeCandidates);
};
