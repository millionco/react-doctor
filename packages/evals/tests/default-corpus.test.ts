import { describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_CORPUS_REPOSITORY_COUNT,
  PINNED_REPOSITORY_REF_PATTERN,
} from "../src/constants.js";
import { groupCorpusRepositories } from "../src/group-corpus-repositories.js";
import { loadCorpusRepositories } from "../src/load-corpus-repositories.js";

describe("default corpus", () => {
  it("contains 2,000 pinned repositories", async () => {
    const repositories = await loadCorpusRepositories([
      new URL("../repositories.json", import.meta.url).pathname,
    ]);
    const repositoryGroups = groupCorpusRepositories(repositories);

    expect(repositoryGroups).toHaveLength(DEFAULT_CORPUS_REPOSITORY_COUNT);
    expect(
      repositories.every((repository) => PINNED_REPOSITORY_REF_PATTERN.test(repository.ref)),
    ).toBe(true);
  });

  it("does not include repositories with measured slow or incomplete scans", async () => {
    const [repositories, excludedRepositories] = await Promise.all([
      loadCorpusRepositories([new URL("../repositories.json", import.meta.url).pathname]),
      loadCorpusRepositories([
        new URL("../excluded-slow-repositories.json", import.meta.url).pathname,
      ]),
    ]);
    const selectedRepositoryKeys = new Set(
      groupCorpusRepositories(repositories).map(
        (repository) => `${repository.org}/${repository.name}@${repository.ref}`,
      ),
    );

    expect(
      groupCorpusRepositories(excludedRepositories).every(
        (repository) =>
          !selectedRepositoryKeys.has(`${repository.org}/${repository.name}@${repository.ref}`),
      ),
    ).toBe(true);
  });
});
