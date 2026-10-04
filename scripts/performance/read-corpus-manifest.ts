import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { CORPUS_DIRECTORY, CORPUS_MANIFEST_FILENAME } from "./constants.ts";
import { isRecord, isRecordWithFields } from "./is-record-with-fields.ts";
import type { CorpusTarget } from "./types.ts";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "../..");

const isCorpusTarget = (value: unknown): value is CorpusTarget =>
  isRecordWithFields(value, { name: "string", repository: "string", sha: "string" }) &&
  /^[a-z0-9][a-z0-9-]*$/.test(String(value.name)) &&
  /^[\w.-]+\/[\w.-]+$/.test(String(value.repository)) &&
  /^[0-9a-f]{40}$/.test(String(value.sha)) &&
  (!("subdirectory" in value) || typeof value.subdirectory === "string") &&
  (!("fileCount" in value) || typeof value.fileCount === "number");

export const readCorpusManifest = (
  manifestPath: string = path.join(SCRIPT_DIRECTORY, CORPUS_MANIFEST_FILENAME),
): CorpusTarget[] => {
  const parsedManifest: unknown = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (
    !isRecord(parsedManifest) ||
    !Array.isArray(parsedManifest.targets) ||
    !parsedManifest.targets.every(isCorpusTarget)
  ) {
    throw new Error(`Invalid performance corpus manifest: ${manifestPath}`);
  }
  const names = new Set<string>();
  for (const target of parsedManifest.targets) {
    if (names.has(target.name)) throw new Error(`Duplicate corpus target name: ${target.name}`);
    names.add(target.name);
  }
  return parsedManifest.targets;
};

export const corpusCheckoutDirectory = (
  target: CorpusTarget,
  corpusDirectory: string = path.join(REPOSITORY_ROOT, CORPUS_DIRECTORY),
): string => path.join(corpusDirectory, target.repository.split("/")[1] ?? target.name);

export const corpusTargetDirectory = (
  target: CorpusTarget,
  corpusDirectory: string = path.join(REPOSITORY_ROOT, CORPUS_DIRECTORY),
): string => {
  const checkoutDirectory = corpusCheckoutDirectory(target, corpusDirectory);
  return target.subdirectory === undefined
    ? checkoutDirectory
    : path.join(checkoutDirectory, target.subdirectory);
};

export const selectCorpusTargets = (
  targets: readonly CorpusTarget[],
  selection: readonly string[],
): CorpusTarget[] =>
  selection.map((name) => {
    const target = targets.find((candidate) => candidate.name === name);
    if (target === undefined) {
      throw new Error(
        `Unknown corpus target "${name}"; known targets: ${targets.map((candidate) => candidate.name).join(", ")}`,
      );
    }
    return target;
  });
