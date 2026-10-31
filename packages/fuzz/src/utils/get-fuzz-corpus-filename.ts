import type { FuzzCorpusEntry } from "../load-fuzz-corpus.js";

export const getFuzzCorpusFilename = (entry: FuzzCorpusEntry, isScanRule: boolean): string => {
  if (entry.sourcePath !== undefined) return entry.sourcePath;
  if (!isScanRule && entry.fixtureFilename !== undefined) return entry.fixtureFilename;
  return entry.relativePath;
};
