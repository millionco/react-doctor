import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Git, StagedFiles, type StagedSnapshot } from "@react-doctor/core";

const stagedFilesLayer = StagedFiles.layerNode.pipe(Layer.provide(Git.layerNode));

export const getStagedSourceFiles = (directory: string): string[] => {
  try {
    const files = Effect.runSync(
      Effect.gen(function* () {
        const stagedFiles = yield* StagedFiles;
        return yield* stagedFiles.discoverSourceFiles(directory);
      }).pipe(Effect.provide(stagedFilesLayer)),
    );
    return [...files];
  } catch {
    return [];
  }
};

interface MaterializeResult {
  tempDirectory: string;
  stagedFiles: string[];
  cleanup: () => void;
}

export const materializeStagedFiles = (
  directory: string,
  stagedFiles: string[],
  tempDirectory: string,
): MaterializeResult => {
  const snapshot: StagedSnapshot = Effect.runSync(
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
