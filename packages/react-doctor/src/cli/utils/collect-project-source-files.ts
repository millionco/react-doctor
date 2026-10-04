import { collectSourceFilesByDirectory } from "@react-doctor/core";
import type { SourceFileEntry } from "@react-doctor/core";
import { activeScanAbortRegistry } from "./active-scan-abort-registry.js";

export const collectProjectSourceFiles = async (
  rootDirectory: string,
  projectDirectories: ReadonlyArray<string>,
): Promise<ReadonlyMap<string, ReadonlyArray<SourceFileEntry>>> => {
  const abortController = new AbortController();
  const unregisterAbortController = activeScanAbortRegistry.register(abortController);
  try {
    return await collectSourceFilesByDirectory(
      rootDirectory,
      projectDirectories,
      abortController.signal,
    );
  } finally {
    unregisterAbortController();
  }
};
