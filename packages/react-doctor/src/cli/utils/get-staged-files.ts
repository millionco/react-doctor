import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Git, StagedFiles, messageFromUnknown, type StagedSnapshot } from "@react-doctor/core";
import { cliLogger } from "./cli-logger.js";
import { CliInputError } from "./cli-input-error.js";

const stagedFilesLayer = StagedFiles.layerNode.pipe(Layer.provide(Git.layerNode));

export const getStagedSourceFiles = async (directory: string): Promise<string[]> => {
  let stagedSourceFiles: ReadonlyArray<string> | null;
  try {
    stagedSourceFiles = await Effect.runPromise(
      Effect.gen(function* () {
        const stagedFiles = yield* StagedFiles;
        return yield* stagedFiles.discoverSourceFiles(directory);
      }).pipe(Effect.provide(stagedFilesLayer)),
    );
  } catch (error) {
    cliLogger.warn(`Failed to discover staged files: ${messageFromUnknown(error)}`);
    return [];
  }
  // `null` means git ran and reported a failure. `--staged` gates a commit, so
  // an unread index must not arrive here as an empty one — that passes the gate
  // without scanning anything.
  if (stagedSourceFiles === null) {
    throw new CliInputError(
      "Could not read the git index to list staged files. Check that git can read the index in this directory.",
    );
  }
  return [...stagedSourceFiles];
};

interface MaterializeResult {
  tempDirectory: string;
  stagedFiles: string[];
  unmaterializedFiles: string[];
  cleanup: () => void;
}

export const materializeStagedFiles = async (input: {
  readonly directory: string;
  readonly stagedFiles: ReadonlyArray<string>;
  readonly tempDirectory: string;
  readonly configSubdirectories?: ReadonlyArray<string>;
}): Promise<MaterializeResult> => {
  const snapshot: StagedSnapshot = await Effect.runPromise(
    Effect.gen(function* () {
      const staged = yield* StagedFiles;
      return yield* staged.materialize(input);
    }).pipe(Effect.provide(stagedFilesLayer)),
  );
  return {
    tempDirectory: snapshot.tempDirectory,
    stagedFiles: [...snapshot.stagedFiles],
    unmaterializedFiles: [...snapshot.unmaterializedFiles],
    cleanup: snapshot.cleanup,
  };
};
