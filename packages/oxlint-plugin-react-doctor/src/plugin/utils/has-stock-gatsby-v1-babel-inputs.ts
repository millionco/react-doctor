import * as fs from "node:fs";
import * as path from "node:path";
import { STOCK_GATSBY_MAX_CONFIG_BYTES } from "../constants/design.js";
import { recordContentProbe, recordExistenceProbe } from "./cross-file-probe-recorder.js";

const readPathState = (filename: string): fs.Stats | null => {
  recordExistenceProbe(filename);
  return fs.lstatSync(filename, { throwIfNoEntry: false }) ?? null;
};

const hasNoPackageBabelConfig = (filename: string): boolean => {
  const stat = readPathState(filename);
  if (!stat) return true;
  recordContentProbe(filename);
  if (
    !stat.isFile() ||
    stat.size > STOCK_GATSBY_MAX_CONFIG_BYTES ||
    fs.realpathSync.native(filename) !== filename
  )
    return false;
  const parsed: unknown = JSON.parse(fs.readFileSync(filename, "utf8"));
  return (
    parsed !== null &&
    typeof parsed === "object" &&
    !Array.isArray(parsed) &&
    !Object.hasOwn(parsed, "babel")
  );
};

/** The selected stock Babel 6 build has no project config or ignore input. */
export const hasStockGatsbyV1BabelInputs = (
  siteRoot: string,
  sourceFiles: ReadonlyArray<string>,
): boolean => {
  if (!path.isAbsolute(siteRoot) || sourceFiles.length === 0) return false;
  const probeDirectories = new Set<string>();
  const origins = [siteRoot, path.join(siteRoot, ".cache")];
  for (const file of sourceFiles) {
    const relative = path.relative(siteRoot, file);
    if (
      !path.isAbsolute(file) ||
      relative === "" ||
      relative === ".." ||
      relative.startsWith(".." + path.sep) ||
      path.isAbsolute(relative)
    )
      return false;
    origins.push(path.dirname(file));
  }
  try {
    if (fs.realpathSync.native(siteRoot) !== siteRoot) return false;
    for (const origin of origins) {
      let directory = origin;
      while (!probeDirectories.has(directory)) {
        const parent = path.dirname(directory);
        if (directory === parent) break; // Babel 6 findConfigs stops before the filesystem root.
        probeDirectories.add(directory);
        if (
          readPathState(path.join(directory, ".babelrc")) ||
          readPathState(path.join(directory, ".babelignore")) ||
          !hasNoPackageBabelConfig(path.join(directory, "package.json"))
        )
          return false;
        directory = parent;
      }
    }
    return true;
  } catch {
    return false;
  }
};
