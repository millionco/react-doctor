import { readFile } from "node:fs/promises";
import * as Path from "node:path";

import type { CorpusRepository } from "./corpus.js";

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

export const loadCorpusRepositories = async (
  repositoriesSource: string,
): Promise<ReadonlyArray<CorpusRepository>> => {
  let source: string;
  if (repositoriesSource.startsWith("https://")) {
    const response = await fetch(repositoriesSource);
    if (!response.ok) {
      throw new Error(`Failed to load corpus: ${response.status} ${response.statusText}`);
    }
    source = await response.text();
  } else {
    source = await readFile(repositoriesSource, "utf8");
  }
  const repositories: unknown = JSON.parse(source);
  if (
    !Array.isArray(repositories) ||
    repositories.length === 0 ||
    !repositories.every(isCorpusRepository)
  ) {
    throw new Error("Corpus must be an array of { org, name, ref, rootDir } records");
  }
  return repositories;
};
