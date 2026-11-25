import * as fs from "node:fs";
import * as path from "node:path";
import { recordExistenceProbe, recordRealpathProbe } from "./cross-file-probe-recorder.js";
import { isPathInside } from "./is-path-inside.js";
import { readProviderMember } from "./stock-vite-providers/resolve-stock-physical-entry.js";

interface ResolvedConfigurationModule {
  readonly filename: string;
  readonly source: string;
}

const ALTERNATE_ENDINGS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".css",
  ".json",
  ".cjs",
  ".mjs",
  ".cts",
  ".mts",
];
const MAX_LOCAL_GENERATOR_BYTES = 128 * 1024;
const stat = (filename: string): fs.Stats | undefined => {
  recordExistenceProbe(filename);
  return fs.lstatSync(filename, { throwIfNoEntry: false });
};
const hasCanonicalScope = (subdirectory: string, projectDirectory: string): boolean => {
  for (
    let directory = subdirectory;
    directory !== projectDirectory;
    directory = path.dirname(directory)
  ) {
    recordRealpathProbe(directory);
    if (
      !isPathInside(directory, projectDirectory) ||
      !stat(directory)?.isDirectory() ||
      fs.realpathSync(directory) !== directory ||
      stat(path.join(directory, "package.json"))
    )
      return false;
  }
  return true;
};

export const readLocalStencilGeneratorModule = (
  projectDirectory: string,
  importerFilename: string,
  request: string,
): ResolvedConfigurationModule | null => {
  if (
    !path.isAbsolute(projectDirectory) ||
    !path.isAbsolute(importerFilename) ||
    !isPathInside(importerFilename, projectDirectory) ||
    !/^\.{1,2}\/[A-Za-z0-9_./-]+$/u.test(request)
  )
    return null;
  const base = path.resolve(path.dirname(importerFilename), request);
  if (base === projectDirectory || !isPathInside(base, projectDirectory)) return null;
  try {
    const suffix = path.extname(base);
    let selected: string;
    if (suffix === ".ts") {
      selected = base;
    } else if (suffix) {
      return null;
    } else {
      const baseEntry = stat(base);
      if (baseEntry && !baseEntry.isDirectory()) return null;
      const siblingCandidates = ALTERNATE_ENDINGS.map((ending) => base + ending);
      const candidates = baseEntry
        ? [
            ...siblingCandidates,
            ...ALTERNATE_ENDINGS.map((ending) => path.join(base, "index" + ending)),
          ]
        : siblingCandidates;
      const existing = candidates.filter((filename) => Boolean(stat(filename)));
      if (existing.length !== 1 || existing[0] === undefined) return null;
      selected = existing[0];
    }
    if (!selected.endsWith(".ts") || !hasCanonicalScope(path.dirname(selected), projectDirectory))
      return null;
    const entry = stat(selected);
    if (!entry?.isFile() || entry.size > MAX_LOCAL_GENERATOR_BYTES) return null;
    const source = readProviderMember(selected);
    return source ? { filename: selected, source: source.toString("utf8") } : null;
  } catch {
    return null;
  }
};
