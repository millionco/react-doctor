import { createReadStream } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import * as Path from "node:path";
import { createInterface } from "node:readline";

import {
  DEFAULT_TARGET_REPOSITORY_REF,
  DEFAULT_TARGET_ROOT_DIRECTORY,
  PINNED_REPOSITORY_REF_PATTERN,
  REPOSITORY_SOURCE_EXTENSIONS,
} from "./constants.js";
import type { CorpusRepository } from "./corpus.js";
import { parseCorpusRepository } from "./utils/parse-corpus-repository.js";
import { parseReactDoctorReport } from "./utils/parse-react-doctor-report.js";

interface RepositorySourceContent {
  source: string;
  content: string;
}

const parseJsonRepositories = (
  source: RepositorySourceContent,
): ReadonlyArray<CorpusRepository> => {
  const repositories: unknown = JSON.parse(source.content);
  if (!Array.isArray(repositories) || repositories.length === 0) {
    throw new Error(`${source.source} must be an array of { org, name, ref, rootDir } records`);
  }
  const parsedRepositories: CorpusRepository[] = [];
  for (const repository of repositories) {
    const parsedRepository = parseCorpusRepository(repository);
    if (!parsedRepository) {
      throw new Error(`${source.source} must be an array of { org, name, ref, rootDir } records`);
    }
    parsedRepositories.push(parsedRepository);
  }
  return parsedRepositories;
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
    const repository = parseCorpusRepository({
      org,
      name,
      ref: DEFAULT_TARGET_REPOSITORY_REF,
      rootDir: DEFAULT_TARGET_ROOT_DIRECTORY,
    });
    if (!repository) {
      throw new Error(`${source.source}:${lineIndex + 1} must be a valid GitHub repository`);
    }
    repositories.push(repository);
  }
  return repositories;
};

const parseEvaluationRecord = (
  source: string,
  lineNumber: number,
  line: string,
): CorpusRepository | null => {
  if (line.trim() === "") return null;
  const record: unknown = JSON.parse(line);
  if (
    typeof record !== "object" ||
    record === null ||
    !("schemaVersion" in record) ||
    record.schemaVersion !== 1 ||
    !("repository" in record)
  ) {
    throw new Error(`${source}:${lineNumber} must be an eval result record`);
  }
  const repository = parseCorpusRepository(record.repository);
  if (!repository) {
    throw new Error(`${source}:${lineNumber} must be an eval result record`);
  }
  if (!PINNED_REPOSITORY_REF_PATTERN.test(repository.ref)) {
    throw new Error(`${source}:${lineNumber} contains an unpinned eval result`);
  }
  if (!("report" in record) || "error" in record) {
    throw new Error(`${source}:${lineNumber} contains an unsuccessful eval result`);
  }
  try {
    parseReactDoctorReport(JSON.stringify(record.report));
  } catch {
    throw new Error(`${source}:${lineNumber} contains an incomplete or invalid eval result`);
  }
  return repository;
};

const parseEvaluationRecords = (
  source: RepositorySourceContent,
): ReadonlyArray<CorpusRepository> => {
  const repositories: Array<CorpusRepository> = [];
  for (const [lineIndex, line] of source.content.split("\n").entries()) {
    const repository = parseEvaluationRecord(source.source, lineIndex + 1, line);
    if (repository) repositories.push(repository);
  }
  return repositories;
};

const streamEvaluationRecords = async (
  source: string,
): Promise<ReadonlyArray<CorpusRepository>> => {
  const repositories: CorpusRepository[] = [];
  const lines = createInterface({ input: createReadStream(source) });
  let lineNumber = 0;
  for await (const line of lines) {
    lineNumber += 1;
    const repository = parseEvaluationRecord(source, lineNumber, line);
    if (repository) repositories.push(repository);
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

const loadRepositorySource = async (
  repositoriesSource: string,
): Promise<ReadonlyArray<CorpusRepository>> => {
  if (repositoriesSource.startsWith("https://")) {
    const response = await fetch(repositoriesSource);
    if (!response.ok) {
      throw new Error(`Failed to load corpus: ${response.status} ${response.statusText}`);
    }
    return parseRepositorySource({ source: repositoriesSource, content: await response.text() });
  }

  const sourceStats = await stat(repositoriesSource);
  if (sourceStats.isDirectory()) {
    const sourceFileNames = (await readdir(repositoriesSource))
      .filter((fileName) => REPOSITORY_SOURCE_EXTENSIONS.includes(Path.extname(fileName)))
      .sort();
    const loadedSources = await Promise.all(
      sourceFileNames.map((fileName) =>
        loadRepositorySource(Path.join(repositoriesSource, fileName)),
      ),
    );
    return loadedSources.flat();
  }

  if (Path.extname(repositoriesSource) === ".ndjson") {
    return streamEvaluationRecords(repositoriesSource);
  }
  return parseRepositorySource({
    source: repositoriesSource,
    content: await readFile(repositoriesSource, "utf8"),
  });
};

export const loadCorpusRepositories = async (
  repositoriesSources: ReadonlyArray<string>,
): Promise<ReadonlyArray<CorpusRepository>> => {
  const loadedSources = await Promise.all(repositoriesSources.map(loadRepositorySource));
  const loadedRepositories = loadedSources.flat();
  const pinnedRepositoryKeys = new Set(
    loadedRepositories
      .filter((repository) => repository.ref !== DEFAULT_TARGET_REPOSITORY_REF)
      .map((repository) => `${repository.org}/${repository.name}`.toLowerCase()),
  );
  const seenProjects = new Set<string>();
  const repositories = loadedRepositories.filter((repository) => {
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
  if (repositories.length === 0) throw new Error("Corpus contains no repositories");
  return repositories;
};
