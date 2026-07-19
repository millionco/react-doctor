import { describe, expect, it } from "vite-plus/test";

import type { CorpusRepositoryGroup } from "../src/corpus.js";
import { partitionRepositoryGroups } from "../src/utils/partition-repository-groups.js";

const buildRepositoryGroup = (name: string, projectCount: number): CorpusRepositoryGroup => ({
  org: "example",
  name,
  ref: "HEAD",
  rootDirectories: Array.from(
    { length: projectCount },
    (_, projectIndex) => `packages/project-${projectIndex}`,
  ),
});

describe("partitionRepositoryGroups", () => {
  it("balances monorepo project roots across the available sandboxes", () => {
    const batches = partitionRepositoryGroups(
      [
        buildRepositoryGroup("large", 8),
        buildRepositoryGroup("medium", 4),
        buildRepositoryGroup("small-a", 2),
        buildRepositoryGroup("small-b", 2),
      ],
      2,
    );

    expect(batches).toHaveLength(2);
    expect(
      batches.map((batch) =>
        batch.reduce(
          (projectCount, repositoryGroup) => projectCount + repositoryGroup.rootDirectories.length,
          0,
        ),
      ),
    ).toEqual([8, 8]);
    expect(batches.flat()).toHaveLength(4);
  });

  it("returns no batches for an empty corpus", () => {
    expect(partitionRepositoryGroups([], 10)).toEqual([]);
  });
});
