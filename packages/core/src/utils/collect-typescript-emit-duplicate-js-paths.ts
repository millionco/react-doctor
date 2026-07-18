import * as path from "node:path";

interface EmitQuartetInput {
  trackedPaths: ReadonlySet<string>;
  untrackedPaths: ReadonlyArray<string>;
  readFileText: (relativePath: string) => string;
}

interface MapTargetInput {
  expectedFile: string;
  mapDirectory: string;
  sourcePath: string;
}

const lastSourceMappingUrl = (fileContent: string): string | null => {
  const references = [...fileContent.matchAll(/\/\/# sourceMappingURL=(\S+)/g)];
  const lastReference = references.at(-1);
  return lastReference ? lastReference[1] : null;
};

const mapTargetsSource = (mapContent: string, input: MapTargetInput): boolean => {
  const parsedMap: unknown = JSON.parse(mapContent);
  if (typeof parsedMap !== "object" || parsedMap === null) return false;
  const { file, sources } = parsedMap as { file?: unknown; sources?: unknown };
  if (file !== input.expectedFile) return false;
  if (!Array.isArray(sources) || sources.length !== 1 || typeof sources[0] !== "string") {
    return false;
  }
  return path.posix.normalize(path.posix.join(input.mapDirectory, sources[0])) === input.sourcePath;
};

const quartetProvesEmit = (
  stem: string,
  sourcePath: string,
  readFileText: EmitQuartetInput["readFileText"],
): boolean => {
  try {
    const emitBaseName = path.posix.basename(stem);
    const mapDirectory = path.posix.dirname(stem);
    return (
      lastSourceMappingUrl(readFileText(`${stem}.js`)) === `${emitBaseName}.js.map` &&
      lastSourceMappingUrl(readFileText(`${stem}.d.ts`)) === `${emitBaseName}.d.ts.map` &&
      mapTargetsSource(readFileText(`${stem}.js.map`), {
        expectedFile: `${emitBaseName}.js`,
        mapDirectory,
        sourcePath,
      }) &&
      mapTargetsSource(readFileText(`${stem}.d.ts.map`), {
        expectedFile: `${emitBaseName}.d.ts`,
        mapDirectory,
        sourcePath,
      })
    );
  } catch {
    return false;
  }
};

// A `.js` file leaves the product scan surface only when a complete untracked
// TypeScript emit quartet (`.js`, `.js.map`, `.d.ts`, `.d.ts.map`) proves it
// duplicates a tracked same-stem `.ts`/`.tsx` source: every quartet member is
// untracked, each source map's `file` names its emitted sibling, its `sources`
// resolve to exactly the tracked source, and the `.js`/`.d.ts` carry matching
// `sourceMappingURL` references. Tracked JavaScript files and incomplete or
// mismatched output sets are always kept.
export const collectTypeScriptEmitDuplicateJsPaths = (
  input: EmitQuartetInput,
): ReadonlySet<string> => {
  const untracked = new Set(input.untrackedPaths);
  const duplicateJsPaths = new Set<string>();
  for (const jsPath of untracked) {
    if (!jsPath.endsWith(".js")) continue;
    const stem = jsPath.slice(0, -".js".length);
    const quartet = [jsPath, `${stem}.js.map`, `${stem}.d.ts`, `${stem}.d.ts.map`];
    const isFullyUntracked = quartet.every(
      (emitPath) => untracked.has(emitPath) && !input.trackedPaths.has(emitPath),
    );
    if (!isFullyUntracked) continue;
    const sourcePath = [`${stem}.ts`, `${stem}.tsx`].find((candidatePath) =>
      input.trackedPaths.has(candidatePath),
    );
    if (!sourcePath) continue;
    if (quartetProvesEmit(stem, sourcePath, input.readFileText)) duplicateJsPaths.add(jsPath);
  }
  return duplicateJsPaths;
};
