import * as Path from "node:path";

import { DEFAULT_TARGET_REPOSITORY_REF, PINNED_REPOSITORY_REF_PATTERN } from "../constants.js";
import type { CorpusRepository } from "../corpus.js";

const GITHUB_OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;
const GITHUB_REPOSITORY_PATTERN = /^[A-Za-z0-9._-]+$/;
const UNSAFE_ROOT_DIRECTORY_PATTERN = /["'`$;&|<>\\]/;

export const parseCorpusRepository = (value: unknown): CorpusRepository | null => {
  if (
    typeof value !== "object" ||
    value === null ||
    !("org" in value) ||
    typeof value.org !== "string" ||
    !GITHUB_OWNER_PATTERN.test(value.org) ||
    !("name" in value) ||
    typeof value.name !== "string" ||
    !GITHUB_REPOSITORY_PATTERN.test(value.name) ||
    !("ref" in value) ||
    typeof value.ref !== "string" ||
    (value.ref !== DEFAULT_TARGET_REPOSITORY_REF &&
      !PINNED_REPOSITORY_REF_PATTERN.test(value.ref)) ||
    !("rootDir" in value) ||
    typeof value.rootDir !== "string" ||
    value.rootDir === "" ||
    value.rootDir.includes("\u0000") ||
    value.rootDir.includes("\r") ||
    value.rootDir.includes("\n") ||
    UNSAFE_ROOT_DIRECTORY_PATTERN.test(value.rootDir)
  ) {
    return null;
  }

  const normalizedRootDirectory = Path.posix.normalize(value.rootDir);
  if (
    Path.posix.isAbsolute(normalizedRootDirectory) ||
    normalizedRootDirectory === ".." ||
    normalizedRootDirectory.startsWith("../")
  ) {
    return null;
  }
  const rootDirectory = normalizedRootDirectory.replace(/\/+$/, "") || ".";

  return {
    org: value.org,
    name: value.name,
    ref: value.ref,
    rootDir: rootDirectory,
  };
};
