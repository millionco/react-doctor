import * as path from "node:path";
import { isProjectBoundary } from "../utils/is-project-boundary.js";
import { isFile } from "./fs-utils.js";

const SHADCN_CONFIG_FILE_NAME = "components.json";

// `components.json` is the shadcn CLI's config file and its canonical
// project marker — `npx shadcn init` writes it at the package root, and
// every generator command refuses to run without it. Presence (not
// parseability) drives the capability: a config with a stray comma should
// not silently switch off the shadcn composition rules.
export const detectShadcnUi = (directory: string): boolean => {
  if (isFile(path.join(directory, SHADCN_CONFIG_FILE_NAME))) return true;
  if (isProjectBoundary(directory)) return false;

  // Monorepo layouts keep the scanned app's config at the workspace root
  // (or an intermediate package), so walk ancestors the same way the
  // React Compiler detection does — stopping at the repository boundary.
  let ancestorDirectory = path.dirname(directory);
  while (ancestorDirectory !== path.dirname(ancestorDirectory)) {
    if (isFile(path.join(ancestorDirectory, SHADCN_CONFIG_FILE_NAME))) return true;
    if (isProjectBoundary(ancestorDirectory)) return false;
    ancestorDirectory = path.dirname(ancestorDirectory);
  }

  return false;
};
