import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_CORPUS_REPOSITORY_COUNT,
  PINNED_REPOSITORY_REF_PATTERN,
  SCAN_COMMAND,
} from "../src/constants.js";
import { groupCorpusRepositories } from "../src/group-corpus-repositories.js";
import { loadCorpusRepositories } from "../src/load-corpus-repositories.js";

const REPOSITORIES_PATH = fileURLToPath(new URL("../repositories.json", import.meta.url));
const EXCLUDED_REPOSITORIES_PATH = fileURLToPath(
  new URL("../excluded-slow-repositories.json", import.meta.url),
);

describe("default corpus", () => {
  it("contains 2,000 pinned repositories", async () => {
    const repositories = await loadCorpusRepositories([REPOSITORIES_PATH]);
    const repositoryGroups = groupCorpusRepositories(repositories);

    expect(repositoryGroups).toHaveLength(DEFAULT_CORPUS_REPOSITORY_COUNT);
    expect(
      repositories.every((repository) => PINNED_REPOSITORY_REF_PATTERN.test(repository.ref)),
    ).toBe(true);
  });

  it("does not include repositories with measured slow or incomplete scans", async () => {
    const [repositories, excludedRepositories] = await Promise.all([
      loadCorpusRepositories([REPOSITORIES_PATH]),
      loadCorpusRepositories([EXCLUDED_REPOSITORIES_PATH]),
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

  it("uses parallel linting for large repositories", () => {
    expect(SCAN_COMMAND).not.toContain("--no-parallel");
  });
});
