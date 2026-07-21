import * as fs from "node:fs";
import * as path from "node:path";
import { MAX_CORPUS_FILES, MAX_CORPUS_FILE_BYTES } from "./constants.js";

export interface FuzzCorpusEntry {
  relativePath: string;
  code: string;
}

export interface FuzzCorpusLoadOptions {
  maximumFiles?: number;
}

const CORPUS_FILE_PATTERN = /\.(tsx|jsx)$/;
const SKIPPED_DIRECTORY_NAMES = new Set(["node_modules", ".git", "dist", "build", "coverage"]);

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
      if (!CORPUS_FILE_PATTERN.test(name)) continue;
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
    if (CORPUS_FILE_PATTERN.test(name) && stats.size <= MAX_CORPUS_FILE_BYTES && stats.size > 0) {
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
      entries.push({
        relativePath: path.relative(corpusDirectory, fullPath),
        code: fs.readFileSync(fullPath, "utf8"),
      });
    } catch {
      continue;
    }
  }
  return entries;
};
