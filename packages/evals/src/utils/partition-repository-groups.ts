import type { CorpusRepositoryGroup } from "../corpus.js";

interface RepositoryGroupBatch {
  repositoryGroups: CorpusRepositoryGroup[];
  projectCount: number;
}

export const partitionRepositoryGroups = (
  repositoryGroups: ReadonlyArray<CorpusRepositoryGroup>,
  repositoriesPerBatch: number,
): ReadonlyArray<ReadonlyArray<CorpusRepositoryGroup>> => {
  const batchCount = Math.ceil(repositoryGroups.length / repositoriesPerBatch);
  if (batchCount === 0) return [];
  const batches: RepositoryGroupBatch[] = Array.from({ length: batchCount }, () => ({
    repositoryGroups: [],
    projectCount: 0,
  }));
  const groupsByDescendingProjectCount = [...repositoryGroups].sort(
    (firstGroup, secondGroup) =>
      secondGroup.rootDirectories.length - firstGroup.rootDirectories.length,
  );

  for (const repositoryGroup of groupsByDescendingProjectCount) {
    let lightestBatch = batches[0];
    for (const candidateBatch of batches.slice(1)) {
      if (
        candidateBatch.projectCount < lightestBatch.projectCount ||
        (candidateBatch.projectCount === lightestBatch.projectCount &&
          candidateBatch.repositoryGroups.length < lightestBatch.repositoryGroups.length)
      ) {
        lightestBatch = candidateBatch;
      }
    }
    lightestBatch.repositoryGroups.push(repositoryGroup);
    lightestBatch.projectCount += repositoryGroup.rootDirectories.length;
  }

  return batches.map((batch) => batch.repositoryGroups);
};
