import path from "node:path";
import { parseGitattributesLinguistPaths } from "./parse-gitattributes-linguist.js";
import { readIgnoreFile } from "./read-ignore-file.js";

// HACK: when react-doctor passes `--ignore-path COMBINED_FILE` to
// oxlint, oxlint stops reading `.eslintignore` automatically. So
// `.eslintignore` MUST be included in the combined file or its
// patterns silently vanish. Order matches user precedence intuition:
// project-wide eslint rules first, then narrower opinions.
const IGNORE_FILENAMES = [".eslintignore", ".oxlintignore", ".prettierignore"];

const cachedPatternsByRoot = new Map<string, string[]>();

// HACK: paired with the existing config-cache pattern so programmatic
// API consumers (watch-mode tools, test runners) can re-collect after
// the user edits an ignore file between calls.
export const clearIgnorePatternsCache = (): void => {
  cachedPatternsByRoot.clear();
};

const computeIgnorePatterns = (rootDirectory: string): string[] => {
  const seen = new Set<string>();
  const patterns: string[] = [];

  const addPattern = (pattern: string): void => {
    if (seen.has(pattern)) return;
    seen.add(pattern);
    patterns.push(pattern);
  };

  for (const filename of IGNORE_FILENAMES) {
    for (const pattern of readIgnoreFile(path.join(rootDirectory, filename))) {
      addPattern(pattern);
    }
  }

  for (const linguistPath of parseGitattributesLinguistPaths(
    path.join(rootDirectory, ".gitattributes"),
  )) {
    addPattern(linguistPath);
  }

  return patterns;
};

// Returns the union of ignore-style patterns from every source react-doctor
// knows about (`.eslintignore` + `.oxlintignore` + `.prettierignore` +
// `.gitattributes` linguist annotations), with cross-file duplicates
// removed. Cached per `rootDirectory` for the lifetime of the module —
// see `clearIgnorePatternsCache` for the invalidation hook.
export const collectIgnorePatterns = (rootDirectory: string): string[] => {
  const cached = cachedPatternsByRoot.get(rootDirectory);
  if (cached !== undefined) return cached;
  const patterns = computeIgnorePatterns(rootDirectory);
  cachedPatternsByRoot.set(rootDirectory, patterns);
  return patterns;
};
