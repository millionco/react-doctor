import * as Effect from "effect/Effect";
import fs from "node:fs";
import path from "node:path";
import { STAGED_FILES_PROJECT_CONFIG_FILENAMES } from "./constants.js";
import type { ReactDoctorError } from "./errors.js";

export interface MaterializedTree {
  readonly tempDirectory: string;
  readonly materializedFiles: ReadonlyArray<string>;
  readonly cleanup: () => void;
}

/**
 * Zip-Slip defense: relative paths come from git (`diff --name-only`), which
 * normalizes during ordinary adds, but a crafted index/pack/symlinked tree can
 * smuggle `..` segments that escape the temp root. Resolve against the temp dir
 * and reject anything that lands outside before writing.
 */
const isPathInsideDirectory = (childAbsolutePath: string, parentAbsolutePath: string): boolean => {
  const relative = path.relative(parentAbsolutePath, childAbsolutePath);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
};

/**
 * Writes a set of source files (supplied by `readContent` — e.g.
 * `git show <ref>:<path>` for a baseline tree, or `git show :<path>` for the
 * index) into a temp tree that mirrors the project layout, copying the
 * well-known project-config files from `directory` so oxlint resolves
 * tsconfig / lint config identically to the working tree. Shared by the staged
 * and baseline scan paths so the zip-slip guard lives in one audited place.
 * Per-file read failures skip that file (the scan proceeds with whatever read
 * cleanly) rather than sinking the whole snapshot.
 */
export const materializeSourceTree = (input: {
  readonly directory: string;
  readonly files: ReadonlyArray<string>;
  readonly tempDirectory: string;
  readonly readContent: (relativePath: string) => Effect.Effect<string | null, ReactDoctorError>;
}): Effect.Effect<MaterializedTree, ReactDoctorError> =>
  Effect.gen(function* () {
    const materializedFiles: string[] = [];
    const resolvedTempDirectory = path.resolve(input.tempDirectory);
    for (const relativePath of input.files) {
      const content = yield* input.readContent(relativePath).pipe(Effect.orElseSucceed(() => null));
      if (content === null) continue;
      const candidateTargetPath = path.resolve(resolvedTempDirectory, relativePath);
      if (!isPathInsideDirectory(candidateTargetPath, resolvedTempDirectory)) continue;
      yield* Effect.sync(() => {
        fs.mkdirSync(path.dirname(candidateTargetPath), { recursive: true });
        fs.writeFileSync(candidateTargetPath, content);
      });
      materializedFiles.push(relativePath);
    }
    yield* Effect.sync(() => {
      for (const configFilename of STAGED_FILES_PROJECT_CONFIG_FILENAMES) {
        const sourcePath = path.join(input.directory, configFilename);
        const targetPath = path.join(resolvedTempDirectory, configFilename);
        if (fs.existsSync(sourcePath) && !fs.existsSync(targetPath)) {
          fs.cpSync(sourcePath, targetPath);
        }
      }
    });
    return {
      tempDirectory: input.tempDirectory,
      materializedFiles,
      cleanup: () => {
        try {
          fs.rmSync(input.tempDirectory, { recursive: true, force: true });
        } catch {
          // Best-effort cleanup; OS tempdir reapers eventually run.
        }
      },
    } satisfies MaterializedTree;
  });
