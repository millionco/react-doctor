import crypto from "node:crypto";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import * as Schema from "effect/Schema";
import type { Diagnostic } from "../types/index.js";
import { DEAD_CODE_CACHE_FILENAME, DEAD_CODE_CACHE_SCHEMA_VERSION } from "../constants.js";
import { Diagnostic as DiagnosticSchema } from "../schemas.js";
import { atomicWriteJson } from "../utils/atomic-write-json.js";
import { failOpenReadJson } from "../utils/fail-open-read-json.js";
import { isRecord } from "../utils/is-record.js";
import { walkSourceTreeFiles } from "../utils/walk-source-tree-files.js";

/**
 * Whole-project dead-code result cache. Dead-code reachability is a
 * whole-project property, so the cache holds ONE entry: the diagnostics of the
 * last complete, successful pass, keyed by a fingerprint over everything the
 * analysis reads. Any input change mints a new key, which makes the stored
 * entry unreachable — so there is nothing to gain from keeping history.
 *
 * The key fingerprints files by (path, mtime, size) — the same stat-based
 * invalidation the plugin's `parse-source-file` cache uses — rather than
 * content-hashing the whole tree, because statting ~9k files costs
 * ~100-200 ms while hashing them costs seconds. The accepted tradeoff, shared
 * with that precedent: an edit that preserves BOTH a file's byte size and its
 * mtime is invisible to the fingerprint. Additions and deletions always
 * invalidate — the sorted path list itself is part of the hash.
 *
 * Every operation fails open: a missing or corrupt cache degrades to a fresh
 * analysis, never to a wrong result.
 */

interface DeadCodeCacheKeyInput {
  /** Canonicalized project root (`checkDeadCode` realpaths it first). */
  readonly rootDirectory: string;
  readonly entryPatterns: ReadonlyArray<string>;
  readonly ignorePatterns: ReadonlyArray<string>;
  readonly tsConfigPath: string | undefined;
  readonly deslopJsModuleSpecifier: string;
}

interface PersistedDeadCodeResultCache {
  readonly version: number;
  readonly key: string;
  readonly diagnostics: ReadonlyArray<unknown>;
}

// The extensions deslop's import-graph walk parses (its DEFAULT_EXTENSIONS),
// so an edit to any file the graph can reach changes the key.
const ANALYZED_FILE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".mjs",
  ".cts",
  ".cjs",
  ".mdx",
  ".astro",
  ".graphql",
  ".gql",
  ".css",
  ".scss",
  ".vue",
  ".svelte",
]);

// Non-source files deslop's entry/workspace/dependency analysis reads:
// manifests (workspace layout, dependency declarations, knip/expo config),
// lockfiles (the proxy for installed `node_modules` metadata — deslop reads
// installed packages' bin/peer fields, which only change through an install
// that rewrites the lockfile), and `.gitignore` files at every level (deslop
// consults git's ignore state for its walk).
const ANALYZED_MANIFEST_NAMES = new Set([
  "package.json",
  "knip.json",
  "app.json",
  "pnpm-workspace.yaml",
  "lerna.json",
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "deno.lock",
  ".gitignore",
]);

// tsconfig/jsconfig files anywhere in the tree — path-alias resolution reads
// the root config, and `extends` chains reach the rest.
const isTsConfigLikeFile = (fileName: string): boolean =>
  (fileName.startsWith("tsconfig") || fileName.startsWith("jsconfig")) &&
  fileName.endsWith(".json");

const isFingerprintedFile = (fileName: string): boolean =>
  ANALYZED_FILE_EXTENSIONS.has(path.extname(fileName).toLowerCase()) ||
  ANALYZED_MANIFEST_NAMES.has(fileName) ||
  isTsConfigLikeFile(fileName);

const collectAnalyzedFileFingerprints = (rootDirectory: string): string[] => {
  const fingerprints: string[] = [];
  for (const { absolutePath, name } of walkSourceTreeFiles(rootDirectory)) {
    if (!isFingerprintedFile(name)) continue;
    try {
      const fileStat = fs.statSync(absolutePath);
      const relativePath = path.relative(rootDirectory, absolutePath).replace(/\\/g, "/");
      fingerprints.push(`${relativePath}:${fileStat.mtimeMs}:${fileStat.size}`);
    } catch {
      // Vanished between walk and stat — same key contribution as deleted.
    }
  }
  return fingerprints.sort();
};

const bundledRequire = createRequire(import.meta.url);

const resolveDeslopVersion = (): string => {
  try {
    const packageJson = JSON.parse(
      fs.readFileSync(bundledRequire.resolve("deslop-js/package.json"), "utf8"),
    );
    return isRecord(packageJson) && typeof packageJson.version === "string"
      ? packageJson.version
      : "unknown";
  } catch {
    return "unknown";
  }
};

export const computeDeadCodeCacheKey = (input: DeadCodeCacheKeyInput): string =>
  crypto
    .createHash("sha1")
    .update(
      JSON.stringify({
        schemaVersion: DEAD_CODE_CACHE_SCHEMA_VERSION,
        deslopVersion: resolveDeslopVersion(),
        deslopJsModuleSpecifier: input.deslopJsModuleSpecifier,
        entryPatterns: input.entryPatterns,
        ignorePatterns: input.ignorePatterns,
        // Which tsconfig filename resolved (its CONTENT rides in the file
        // fingerprints below; existence/choice is what this captures).
        tsConfigFile:
          input.tsConfigPath === undefined
            ? null
            : path.relative(input.rootDirectory, input.tsConfigPath).replace(/\\/g, "/"),
        files: collectAnalyzedFileFingerprints(input.rootDirectory),
      }),
    )
    .digest("hex");

const validateDiagnostic = Schema.decodeUnknownSync(DiagnosticSchema);

// Returns `null` if ANY stored entry is malformed, so a corrupt file degrades
// to a whole-pass miss rather than a partial diagnostic set. The records were
// serialized straight from `checkDeadCode`'s `Diagnostic[]`, so the validated
// array replays as-is in its original (deterministic) order.
const decodeCachedDiagnostics = (raw: ReadonlyArray<unknown>): ReadonlyArray<Diagnostic> | null => {
  try {
    for (const entry of raw) validateDiagnostic(entry);
    return raw as ReadonlyArray<Diagnostic>;
  } catch {
    return null;
  }
};

export const lookupDeadCodeResultCache = (
  cacheDirectory: string,
  cacheKey: string,
): ReadonlyArray<Diagnostic> | null => {
  const persisted = failOpenReadJson<PersistedDeadCodeResultCache | null>(
    path.join(cacheDirectory, DEAD_CODE_CACHE_FILENAME),
    null,
  );
  if (
    persisted === null ||
    !isRecord(persisted) ||
    persisted.version !== DEAD_CODE_CACHE_SCHEMA_VERSION ||
    persisted.key !== cacheKey ||
    !Array.isArray(persisted.diagnostics)
  ) {
    return null;
  }
  return decodeCachedDiagnostics(persisted.diagnostics);
};

export const storeDeadCodeResultCache = (
  cacheDirectory: string,
  cacheKey: string,
  diagnostics: ReadonlyArray<Diagnostic>,
): void => {
  atomicWriteJson(path.join(cacheDirectory, DEAD_CODE_CACHE_FILENAME), {
    version: DEAD_CODE_CACHE_SCHEMA_VERSION,
    key: cacheKey,
    diagnostics,
  });
};
