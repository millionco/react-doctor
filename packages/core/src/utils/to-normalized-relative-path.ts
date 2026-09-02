import * as path from "node:path";
import { resolveCandidateReadPath } from "./resolve-candidate-read-path.js";

export const toNormalizedRelativePath = (filePath: string, rootDirectory: string): string =>
  path
    .relative(
      path.resolve(rootDirectory),
      path.resolve(resolveCandidateReadPath(rootDirectory, filePath)),
    )
    .replaceAll("\\", "/") || ".";
