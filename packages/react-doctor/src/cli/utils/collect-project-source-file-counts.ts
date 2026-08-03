import { collectSourceFileCountsByDirectory } from "@react-doctor/core";
import { activeScanAbortRegistry } from "./active-scan-abort-registry.js";

export const collectProjectSourceFileCounts = async (
  rootDirectory: string,
  projectDirectories: ReadonlyArray<string>,
): Promise<ReadonlyMap<string, number>> => {
  const abortController = new AbortController();
  const unregisterAbortController = activeScanAbortRegistry.register(abortController);
  try {
    return await collectSourceFileCountsByDirectory(
      rootDirectory,
      projectDirectories,
      abortController.signal,
    );
  } finally {
    unregisterAbortController();
  }
};
