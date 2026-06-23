import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Git, StagedFiles, type StagedSnapshot } from "@react-doctor/core";
import { cliLogger } from "./cli-logger.js";

const stagedFilesLayer = StagedFiles.layerNode.pipe(Layer.provide(Git.layerNode));

export const getStagedSourceFiles = async (directory: string): Promise<string[]> => {
  try {
    const files = await Effect.runPromise(
      Effect.gen(function* () {
        const stagedFiles = yield* StagedFiles;
        return yield* stagedFiles.discoverSourceFiles(directory);
      }).pipe(Effect.provide(stagedFilesLayer)),
    );
    return [...files];
  } catch (error) {
    cliLogger.warn(
      `Failed to discover staged files: ${error instanceof Error ? error.message : String(error)}`,
    );
    return [];
  }
};

interface MaterializeResult {
  tempDirectory: string;
  stagedFiles: string[];
  cleanup: () => void;
}

export const materializeStagedFiles = async (
  directory: string,
  stagedFiles: string[],
  tempDirectory: string,
): Promise<MaterializeResult> => {
  const snapshot: StagedSnapshot = await Effect.runPromise(
    Effect.gen(function* () {
      const staged = yield* StagedFiles;
      return yield* staged.materialize({ directory, stagedFiles, tempDirectory });
    }).pipe(Effect.provide(stagedFilesLayer)),
  );
  return {
    tempDirectory: snapshot.tempDirectory,
    stagedFiles: [...snapshot.stagedFiles],
    cleanup: snapshot.cleanup,
  };
};
