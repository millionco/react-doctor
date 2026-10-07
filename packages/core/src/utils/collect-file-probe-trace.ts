import * as fs from "node:fs";
import type { collectCrossFileDependencyProbes } from "oxlint-plugin-react-doctor/core";

type CollectCrossFileDependencyProbes = typeof collectCrossFileDependencyProbes;

// One read + collect shape for the parent thread and the pool workers, so the
// probe sets they produce for a file are identical wherever the work ran. Any
// failure (unreadable file, parse error) means the file is unfingerprintable.
export const collectFileProbeTrace = (
  collect: CollectCrossFileDependencyProbes,
  absoluteFilePath: string,
  ruleIds: ReadonlyArray<string>,
): ReturnType<CollectCrossFileDependencyProbes> | null => {
  try {
    return collect({
      absoluteFilePath,
      sourceText: fs.readFileSync(absoluteFilePath, "utf8"),
      ruleIds,
    });
  } catch {
    return null;
  }
};
