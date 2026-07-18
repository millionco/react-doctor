import { readFile, readdir, stat } from "node:fs/promises";
import * as Path from "node:path";

import {
  DEFAULT_TARGET_REPOSITORY_REF,
  DEFAULT_TARGET_ROOT_DIRECTORY,
  PINNED_REPOSITORY_REF_PATTERN,
  REPOSITORY_SOURCE_EXTENSIONS,
} from "./constants.js";
import type { CorpusRepository } from "./corpus.js";

interface RepositorySourceContent {
  source: string;
  content: string;
}

const isCorpusRepository = (value: unknown): value is CorpusRepository => {
  if (typeof value !== "object" || value === null) return false;
  if (
    "org" in value &&
    typeof value.org === "string" &&
    "name" in value &&
    typeof value.name === "string" &&
    "ref" in value &&
    typeof value.ref === "string" &&
    "rootDir" in value &&
    typeof value.rootDir === "string"
  ) {
    const rootDirectory = Path.posix.normalize(value.rootDir);
    return (
      !Path.posix.isAbsolute(rootDirectory) &&
      rootDirectory !== ".." &&
      !rootDirectory.startsWith("../")
    );
  }
  return false;
};

const readRepositorySource = async (
  repositoriesSource: string,
): Promise<ReadonlyArray<RepositorySourceContent>> => {
  if (repositoriesSource.startsWith("https://")) {
    const response = await fetch(repositoriesSource);
    if (!response.ok) {
      throw new Error(`Failed to load corpus: ${response.status} ${response.statusText}`);
    }
    return [{ source: repositoriesSource, content: await response.text() }];
  }

  const sourceStats = await stat(repositoriesSource);
  if (!sourceStats.isDirectory()) {
    return [{ source: repositoriesSource, content: await readFile(repositoriesSource, "utf8") }];
  }

  const sourceFileNames = (await readdir(repositoriesSource))
    .filter((fileName) => REPOSITORY_SOURCE_EXTENSIONS.includes(Path.extname(fileName)))
    .sort();
  return Promise.all(
    sourceFileNames.map(async (fileName) => {
      const source = Path.join(repositoriesSource, fileName);
      return { source, content: await readFile(source, "utf8") };
    }),
  );
};

const parseJsonRepositories = (
  source: RepositorySourceContent,
): ReadonlyArray<CorpusRepository> => {
  const repositories: unknown = JSON.parse(source.content);
  if (
    !Array.isArray(repositories) ||
    repositories.length === 0 ||
    !repositories.every(isCorpusRepository)
  ) {
    throw new Error(`${source.source} must be an array of { org, name, ref, rootDir } records`);
  }
  return repositories;
};

const parseTextRepositories = (
  source: RepositorySourceContent,
): ReadonlyArray<CorpusRepository> => {
  const repositories: Array<CorpusRepository> = [];
  for (const [lineIndex, line] of source.content.split("\n").entries()) {
    const trimmedLine = line.trim();
    if (trimmedLine === "" || trimmedLine.startsWith("#")) continue;
    const match = /^(?:https:\/\/github\.com\/)?([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(
      trimmedLine,
    );
    const org = match?.[1];
    const name = match?.[2];
    if (!org || !name) {
      throw new Error(`${source.source}:${lineIndex + 1} must be owner/name or a GitHub URL`);
    }
    repositories.push({
      org,
      name,
      ref: DEFAULT_TARGET_REPOSITORY_REF,
      rootDir: DEFAULT_TARGET_ROOT_DIRECTORY,
    });
  }
  return repositories;
};

const parseEvaluationRecords = (
  source: RepositorySourceContent,
): ReadonlyArray<CorpusRepository> => {
  const repositories: Array<CorpusRepository> = [];
  for (const [lineIndex, line] of source.content.split("\n").entries()) {
    if (line.trim() === "") continue;
    const record: unknown = JSON.parse(line);
    if (
      typeof record !== "object" ||
      record === null ||
      !("repository" in record) ||
      !isCorpusRepository(record.repository)
    ) {
      throw new Error(`${source.source}:${lineIndex + 1} must be an eval result record`);
    }
    if (!PINNED_REPOSITORY_REF_PATTERN.test(record.repository.ref)) {
      throw new Error(`${source.source}:${lineIndex + 1} contains an unpinned eval result`);
    }
    repositories.push(record.repository);
  }
  return repositories;
};

const parseRepositorySource = (
  source: RepositorySourceContent,
): ReadonlyArray<CorpusRepository> => {
  const firstCharacter = source.content.trimStart()[0];
  if (firstCharacter === "[") return parseJsonRepositories(source);
  if (firstCharacter === "{") return parseEvaluationRecords(source);
  return parseTextRepositories(source);
};

export const loadCorpusRepositories = async (
  repositoriesSources: ReadonlyArray<string>,
): Promise<ReadonlyArray<CorpusRepository>> => {
  const sourceContents = (await Promise.all(repositoriesSources.map(readRepositorySource))).flat();
  const loadedRepositories = sourceContents.flatMap(parseRepositorySource);
  const pinnedRepositoryKeys = new Set(
    loadedRepositories
      .filter((repository) => repository.ref !== DEFAULT_TARGET_REPOSITORY_REF)
      .map((repository) => `${repository.org}/${repository.name}`.toLowerCase()),
  );
  const seenProjects = new Set<string>();
  return loadedRepositories.filter((repository) => {
    const repositoryKey = `${repository.org}/${repository.name}`.toLowerCase();
    if (
      repository.ref === DEFAULT_TARGET_REPOSITORY_REF &&
      pinnedRepositoryKeys.has(repositoryKey)
    ) {
      return false;
    }
    const projectKey = `${repositoryKey}\0${repository.ref}\0${repository.rootDir}`;
    if (seenProjects.has(projectKey)) return false;
    seenProjects.add(projectKey);
    return true;
  });
};
