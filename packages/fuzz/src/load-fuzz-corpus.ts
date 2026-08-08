import * as fs from "node:fs";
import * as path from "node:path";
import { MAX_CORPUS_FILES, MAX_CORPUS_FILE_BYTES } from "./constants.js";

export interface FuzzCorpusEntry {
  relativePath: string;
  code: string;
  ruleIds?: string[];
  verdict?: "pass" | "fail";
}

export interface FuzzCorpusLoadOptions {
  maximumFiles?: number;
}

const CORPUS_FILE_PATTERN = /\.(tsx|ts|jsx|js)$/;
const RULE_DIRECTIVE_PATTERN = /^\/\/ rule: (.+)$/m;
const VERDICT_DIRECTIVE_PATTERN = /^\/\/ verdict: (pass|fail)$/m;
const SKIPPED_DIRECTORY_NAMES = new Set(["node_modules", ".git", "dist", "build", "coverage"]);

const isCorpusFileName = (fileName: string): boolean =>
  CORPUS_FILE_PATTERN.test(fileName) && !fileName.endsWith(".d.ts");

const readCorpusDirectives = (code: string): Pick<FuzzCorpusEntry, "ruleIds" | "verdict"> => {
  const ruleIds = RULE_DIRECTIVE_PATTERN.exec(code)?.[1]
    ?.split(",")
    .map((ruleId) => ruleId.trim())
    .filter(Boolean);
  const verdict = VERDICT_DIRECTIVE_PATTERN.exec(code)?.[1];
  const directives: Pick<FuzzCorpusEntry, "ruleIds" | "verdict"> = {};
  if (ruleIds && ruleIds.length > 0) directives.ruleIds = ruleIds;
  if (verdict === "pass" || verdict === "fail") directives.verdict = verdict;
  return directives;
};

const collectCorpusFilePaths = (rootDirectory: string, budget: number): string[] => {
  const filePaths: string[] = [];
  const walk = (directory: string): void => {
    if (filePaths.length >= budget) return;
    let names: string[];
    try {
      names = fs.readdirSync(directory).sort();
    } catch {
      return;
    }
    for (const name of names) {
      if (filePaths.length >= budget) return;
      const fullPath = path.join(directory, name);
      let stats: fs.Stats;
      try {
        stats = fs.statSync(fullPath);
      } catch {
        continue;
      }
      if (stats.isDirectory()) {
        if (!SKIPPED_DIRECTORY_NAMES.has(name)) walk(fullPath);
        continue;
      }
      if (!isCorpusFileName(name)) continue;
      if (stats.size > MAX_CORPUS_FILE_BYTES || stats.size === 0) continue;
      filePaths.push(fullPath);
    }
  };
  walk(rootDirectory);
  return filePaths;
};

// Loads real-world React files (e.g. a checkout of react-bench corpus
// repos) to fuzz FROM instead of generating from scratch — the AFL-style
// seed-corpus strategy. The cap is spread round-robin across top-level
// subdirectories so a multi-repo corpus directory contributes files from
// EVERY repo, not just the alphabetically first one. Deterministic for a
// fixed directory state.
export const loadFuzzCorpus = (
  corpusDirectory: string,
  options: FuzzCorpusLoadOptions = {},
): FuzzCorpusEntry[] => {
  const maximumFiles = options.maximumFiles ?? MAX_CORPUS_FILES;
  let topLevelNames: string[];
  try {
    topLevelNames = fs.readdirSync(corpusDirectory).sort();
  } catch {
    return [];
  }
  const buckets: string[][] = [];
  const looseFiles: string[] = [];
  for (const name of topLevelNames) {
    const fullPath = path.join(corpusDirectory, name);
    let stats: fs.Stats;
    try {
      stats = fs.statSync(fullPath);
    } catch {
      continue;
    }
    if (stats.isDirectory()) {
      if (SKIPPED_DIRECTORY_NAMES.has(name)) continue;
      buckets.push(collectCorpusFilePaths(fullPath, maximumFiles));
      continue;
    }
    if (isCorpusFileName(name) && stats.size <= MAX_CORPUS_FILE_BYTES && stats.size > 0) {
      looseFiles.push(fullPath);
    }
  }
  if (looseFiles.length > 0) buckets.push(looseFiles);

  const selectedPaths: string[] = [];
  for (let round = 0; selectedPaths.length < maximumFiles; round += 1) {
    let didSelect = false;
    for (const bucket of buckets) {
      if (selectedPaths.length >= maximumFiles) break;
      const candidate = bucket[round];
      if (candidate === undefined) continue;
      selectedPaths.push(candidate);
      didSelect = true;
    }
    if (!didSelect) break;
  }

  const entries: FuzzCorpusEntry[] = [];
  for (const fullPath of selectedPaths) {
    try {
      const code = fs.readFileSync(fullPath, "utf8");
      entries.push({
        relativePath: path.relative(corpusDirectory, fullPath).split(path.sep).join("/"),
        code,
        ...readCorpusDirectives(code),
      });
    } catch {
      continue;
    }
  }
  return entries;
};
