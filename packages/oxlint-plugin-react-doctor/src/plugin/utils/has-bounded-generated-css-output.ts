import * as fs from "node:fs";
import * as path from "node:path";
import { recordExistenceProbe, recordRealpathProbe } from "./cross-file-probe-recorder.js";

interface GeneratedCssOutputInput {
  readonly projectRoot: string;
  readonly cssOutput: string;
  readonly buildOverrides: string;
}

const OUTPUT_COMPONENT = /^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/u;

const readStat = (filename: string): fs.Stats | undefined => {
  recordExistenceProbe(filename);
  return fs.lstatSync(filename, { throwIfNoEntry: false });
};

const isCanonical = (filename: string): boolean => {
  recordRealpathProbe(filename);
  return fs.realpathSync(filename) === filename;
};

export const hasBoundedGeneratedCssOutput = ({
  projectRoot,
  cssOutput,
  buildOverrides,
}: GeneratedCssOutputInput): boolean => {
  const components = cssOutput.split("/");
  if (
    !path.isAbsolute(projectRoot) ||
    path.resolve(projectRoot) !== projectRoot ||
    !cssOutput.endsWith(".css") ||
    components.some((name) => !OUTPUT_COMPONENT.test(name) || name === "node_modules") ||
    !/^\.?[A-Za-z0-9_-][A-Za-z0-9_.-]*\.json$/u.test(buildOverrides)
  )
    return false;
  try {
    if (
      !readStat(projectRoot)?.isDirectory() ||
      !isCanonical(projectRoot) ||
      readStat(path.join(projectRoot, buildOverrides))
    )
      return false;
    const basename = components.pop()!;
    let directory = projectRoot;
    for (const component of components) {
      directory = path.join(directory, component);
      const info = readStat(directory);
      if (info && (!info.isDirectory() || !isCanonical(directory))) return false;
    }
    const output = path.join(directory, basename);
    const info = readStat(output);
    return !info || (info.isFile() && info.nlink === 1 && isCanonical(output));
  } catch {
    return false;
  }
};
