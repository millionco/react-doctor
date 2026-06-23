import { SHADOWED_DIRECTORY_MIN_CLUSTERS } from "../constants.js";
import type { DuplicateBlockCluster, ShadowedDirectoryPair } from "../types.js";

interface DirectoryAndFile {
  directory: string;
  baseName: string;
}

interface PairEntry {
  baseName: string;
  duplicatedLines: number;
}

const splitDirectoryAndFile = (filePath: string): DirectoryAndFile => {
  const trailingSlashIndex = filePath.lastIndexOf("/");
  if (trailingSlashIndex === -1) return { directory: "", baseName: filePath };
  return {
    directory: filePath.slice(0, trailingSlashIndex + 1),
    baseName: filePath.slice(trailingSlashIndex + 1),
  };
};

const toRelative = (filePath: string, rootDir: string): string => {
  if (filePath.startsWith(rootDir + "/")) return filePath.slice(rootDir.length + 1);
  if (filePath === rootDir) return "";
  return filePath;
};

/**
 * Collapse N two-file duplicate-block clusters that share the same
 * `(directoryA, directoryB)` and matching basenames into a single
 * `ShadowedDirectoryPair` finding — the directories themselves drifted
 * (e.g. `src/` vs `deno/lib/`, a fork, a copy-paste of a route tree).
 */
export const detectShadowedDirectoryPairs = (
  duplicateBlockClusters: DuplicateBlockCluster[],
  rootDir: string,
): ShadowedDirectoryPair[] => {
  const directoryPairBuckets = new Map<string, PairEntry[]>();

  for (const cluster of duplicateBlockClusters) {
    if (cluster.files.length !== 2) continue;
    const [firstFile, secondFile] = cluster.files;
    const firstSplit = splitDirectoryAndFile(toRelative(firstFile, rootDir));
    const secondSplit = splitDirectoryAndFile(toRelative(secondFile, rootDir));
    if (firstSplit.baseName !== secondSplit.baseName) continue;

    const [smallerDirectory, largerDirectory] =
      firstSplit.directory <= secondSplit.directory
        ? [firstSplit.directory, secondSplit.directory]
        : [secondSplit.directory, firstSplit.directory];
    const pairKey = `${smallerDirectory}::${largerDirectory}`;
    const entry: PairEntry = {
      baseName: firstSplit.baseName,
      duplicatedLines: cluster.totalDuplicatedLines,
    };
    const existing = directoryPairBuckets.get(pairKey);
    if (existing) existing.push(entry);
    else directoryPairBuckets.set(pairKey, [entry]);
  }

  const shadowedDirectoryPairs: ShadowedDirectoryPair[] = [];
  for (const [pairKey, entries] of directoryPairBuckets) {
    if (entries.length < SHADOWED_DIRECTORY_MIN_CLUSTERS) continue;
    const [directoryA, directoryB] = pairKey.split("::");
    const sharedBaseNames = [...new Set(entries.map((entry) => entry.baseName))].sort();
    const totalDuplicatedLines = entries.reduce(
      (runningSum, entry) => runningSum + entry.duplicatedLines,
      0,
    );
    shadowedDirectoryPairs.push({
      directoryA,
      directoryB,
      sharedFiles: sharedBaseNames,
      totalDuplicatedLines,
    });
  }

  shadowedDirectoryPairs.sort(
    (leftPair, rightPair) => rightPair.totalDuplicatedLines - leftPair.totalDuplicatedLines,
  );
  return shadowedDirectoryPairs;
};
