import { PINNED_REPOSITORY_REF_PATTERN } from "../constants.js";
import type { CorpusRepository } from "../corpus.js";
import { parseCorpusRepository } from "./parse-corpus-repository.js";

const MATRIX_CORPUS_REPOSITORY_KEYS = ["name", "org", "ref", "rootDir"];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const parseMatrixCorpusManifest = (contents: Buffer): ReadonlyArray<CorpusRepository> => {
  const manifest: unknown = JSON.parse(contents.toString("utf8"));
  if (!Array.isArray(manifest) || manifest.length === 0) {
    throw new Error("Matrix corpus manifest must be a nonempty JSON array");
  }
  const repositories: CorpusRepository[] = [];
  const projectKeys = new Set<string>();
  for (const [repositoryIndex, value] of manifest.entries()) {
    const repository = parseCorpusRepository(value);
    if (
      repository &&
      (!PINNED_REPOSITORY_REF_PATTERN.test(repository.ref) ||
        repository.ref !== repository.ref.toLowerCase())
    ) {
      throw new Error("Matrix corpus manifest must pin every repository with a lowercase commit");
    }
    if (
      !isRecord(value) ||
      !repository ||
      Object.keys(value).sort().join("\0") !== MATRIX_CORPUS_REPOSITORY_KEYS.join("\0") ||
      value.rootDir !== repository.rootDir
    ) {
      throw new Error(`Matrix corpus manifest repository ${repositoryIndex + 1} is invalid`);
    }
    const projectKey = JSON.stringify([
      repository.org,
      repository.name,
      repository.ref,
      repository.rootDir,
    ]);
    if (projectKeys.has(projectKey)) {
      throw new Error(`Matrix corpus manifest repository ${repositoryIndex + 1} is duplicated`);
    }
    projectKeys.add(projectKey);
    repositories.push(repository);
  }
  return repositories;
};
