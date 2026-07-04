import crypto from "node:crypto";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import * as Schema from "effect/Schema";
import { ANALYZED_MANIFEST_FILENAMES, DEFAULT_EXTENSIONS } from "deslop-js/analyzed-inputs";
import type { Diagnostic } from "../types/index.js";
import { DEAD_CODE_CACHE_FILENAME, DEAD_CODE_CACHE_SCHEMA_VERSION } from "../constants.js";
import { Diagnostic as DiagnosticSchema } from "../schemas.js";
import { atomicWriteJson } from "../utils/atomic-write-json.js";
import { failOpenReadJson } from "../utils/fail-open-read-json.js";
import { hashFileContents } from "../utils/hash-file-contents.js";
import { isRecord } from "../utils/is-record.js";
import { walkSourceTreeFiles } from "../utils/walk-source-tree-files.js";

/**
 * Whole-project dead-code result cache. Dead-code reachability is a
 * whole-project property, so the cache holds ONE entry: the diagnostics of the
 * last complete, successful pass, keyed by everything the analysis reads. Any
 * input change makes the stored entry unreachable — so there is nothing to
 * gain from keeping history.
 *
 * The entry records every analyzed file as (mtime, size, content hash). A
 * lookup verifies files by stat first — ~100-200 ms to stat ~9k files versus
 * seconds to hash them — and REPAIRS a stat mismatch by hashing the file's
 * current content: identical content accepts the entry and refreshes the
 * stored stat (the ninja/restat pattern), so a fresh CI checkout — where every
 * mtime is checkout time but content is unchanged — pays the hash once per
 * checkout, not a full re-analysis (and not once per run). Additions and
 * deletions always invalidate — path-set equality is checked both ways. The
 * accepted blind spot, shared with deslop's summary cache: an edit DURING the
 * analysis that lands between store-time hash and stat re-verification.
 *
 * Every operation fails open: a missing or corrupt cache degrades to a fresh
 * analysis, never to a wrong result.
 */

interface AnalyzedFileStat {
  readonly mtimeMs: number;
  readonly size: number;
}

interface DeadCodeCacheKeyInput {
  /** Canonicalized project root (`checkDeadCode` realpaths it first). */
  readonly rootDirectory: string;
  readonly entryPatterns: ReadonlyArray<string>;
  readonly ignorePatterns: ReadonlyArray<string>;
  readonly tsConfigPath: string | undefined;
  readonly deslopJsModuleSpecifier: string;
  /**
   * `@react-doctor/core`'s own version (`CORE_PACKAGE_VERSION`). Cached
   * entries store diagnostics AFTER `checkDeadCode`'s post-processing
   * (message text, toolchain-dependency filtering), so a core upgrade must
   * invalidate them even when the analyzed tree is unchanged.
   */
  readonly coreVersion: string;
}

/** Persisted per-file identity: `[mtimeMs, size, contentHash]`. */
type PersistedFileIdentity = readonly [number, number, string];

interface PersistedDeadCodeResultCache {
  readonly version: number;
  readonly key: string;
  readonly files: Record<string, PersistedFileIdentity>;
  readonly diagnostics: ReadonlyArray<unknown>;
}

// The fingerprinted file sets come straight from the analyzer package
// (`deslop-js/analyzed-inputs`): the extensions its import-graph walk parses
// and every manifest/lockfile/.gitignore name its analysis reads. The worker
// resolves deslop-js from the same install, so these constants are exactly
// what the analysis will use — and a deslop version bump also rotates the key
// via the `deslopVersion` field (belt and suspenders).
const ANALYZED_FILE_EXTENSIONS = new Set(DEFAULT_EXTENSIONS);

// Beyond what deslop itself reads, the dead-code PASS also depends on:
// `knip.json` (read core-side by `collect-dead-code-patterns.ts` to derive
// the entry/ignore patterns) and `deno.lock` (an extra proxy for installed
// `node_modules` metadata — deslop reads installed packages' bin/peer fields,
// which only change through an install that rewrites a lockfile).
const CORE_SIDE_MANIFEST_NAMES = ["knip.json", "deno.lock"];

const ANALYZED_MANIFEST_NAMES = new Set([
  ...ANALYZED_MANIFEST_FILENAMES,
  ...CORE_SIDE_MANIFEST_NAMES,
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

/**
 * Stat snapshot of every file the analysis reads, keyed by root-relative
 * `/`-separated path. Taken BEFORE the (long) analysis so a stored result is
 * verified against the tree it started from.
 */
export const collectAnalyzedFileStats = (
  rootDirectory: string,
): ReadonlyMap<string, AnalyzedFileStat> => {
  const statByRelativePath = new Map<string, AnalyzedFileStat>();
  for (const { absolutePath, name } of walkSourceTreeFiles(rootDirectory)) {
    if (!isFingerprintedFile(name)) continue;
    try {
      const fileStat = fs.statSync(absolutePath);
      const relativePath = path.relative(rootDirectory, absolutePath).replace(/\\/g, "/");
      statByRelativePath.set(relativePath, { mtimeMs: fileStat.mtimeMs, size: fileStat.size });
    } catch {
      // Vanished between walk and stat — same contribution as deleted.
    }
  }
  return statByRelativePath;
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

// Everything that changes what a stored entry MEANS besides the analyzed
// files themselves, which are carried per-entry (see `files`) so they can be
// verified — and mtime-repaired — file by file.
export const computeDeadCodeCacheKey = (input: DeadCodeCacheKeyInput): string =>
  crypto
    .createHash("sha1")
    .update(
      JSON.stringify({
        schemaVersion: DEAD_CODE_CACHE_SCHEMA_VERSION,
        coreVersion: input.coreVersion,
        deslopVersion: resolveDeslopVersion(),
        deslopJsModuleSpecifier: input.deslopJsModuleSpecifier,
        entryPatterns: input.entryPatterns,
        ignorePatterns: input.ignorePatterns,
        // Which tsconfig filename resolved (its CONTENT rides in the per-file
        // identities; existence/choice is what this captures).
        tsConfigFile:
          input.tsConfigPath === undefined
            ? null
            : path.relative(input.rootDirectory, input.tsConfigPath).replace(/\\/g, "/"),
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

const isPersistedFileIdentity = (value: unknown): value is PersistedFileIdentity =>
  Array.isArray(value) &&
  value.length === 3 &&
  typeof value[0] === "number" &&
  typeof value[1] === "number" &&
  typeof value[2] === "string";

export interface DeadCodeResultCacheLookupInput {
  readonly cacheDirectory: string;
  readonly cacheKey: string;
  readonly rootDirectory: string;
  /** The pre-analysis stat snapshot (`collectAnalyzedFileStats`). */
  readonly currentFileStats: ReadonlyMap<string, AnalyzedFileStat>;
}

export const lookupDeadCodeResultCache = (
  input: DeadCodeResultCacheLookupInput,
): ReadonlyArray<Diagnostic> | null => {
  const cacheFilePath = path.join(input.cacheDirectory, DEAD_CODE_CACHE_FILENAME);
  const persisted = failOpenReadJson<PersistedDeadCodeResultCache | null>(cacheFilePath, null);
  if (
    persisted === null ||
    !isRecord(persisted) ||
    persisted.version !== DEAD_CODE_CACHE_SCHEMA_VERSION ||
    persisted.key !== input.cacheKey ||
    !isRecord(persisted.files) ||
    !Array.isArray(persisted.diagnostics)
  ) {
    return null;
  }
  const storedFileEntries = Object.entries(persisted.files);
  // Path-set equality both ways: equal counts plus every stored path present
  // means neither additions nor deletions can slip through.
  if (storedFileEntries.length !== input.currentFileStats.size) return null;
  const repairedFiles: Record<string, PersistedFileIdentity> = {};
  let repairedCount = 0;
  for (const [relativePath, storedIdentity] of storedFileEntries) {
    if (!isPersistedFileIdentity(storedIdentity)) return null;
    const currentStat = input.currentFileStats.get(relativePath);
    if (currentStat === undefined) return null;
    const [storedMtimeMs, storedSize, storedContentHash] = storedIdentity;
    if (currentStat.mtimeMs === storedMtimeMs && currentStat.size === storedSize) {
      repairedFiles[relativePath] = storedIdentity;
      continue;
    }
    // A size change is a content change; only a same-size stat mismatch (the
    // fresh-checkout case) is worth the hash-and-repair read.
    if (currentStat.size !== storedSize) return null;
    const currentContentHash = hashFileContents(path.join(input.rootDirectory, relativePath));
    if (currentContentHash === null || currentContentHash !== storedContentHash) return null;
    repairedFiles[relativePath] = [currentStat.mtimeMs, currentStat.size, storedContentHash];
    repairedCount += 1;
  }
  const diagnostics = decodeCachedDiagnostics(persisted.diagnostics);
  if (diagnostics === null) return null;
  if (repairedCount > 0) {
    // Persist the refreshed stats so the repair cost is paid once per
    // checkout: the next lookup takes the stat fast path.
    atomicWriteJson(cacheFilePath, {
      version: DEAD_CODE_CACHE_SCHEMA_VERSION,
      key: input.cacheKey,
      files: repairedFiles,
      diagnostics: persisted.diagnostics,
    });
  }
  return diagnostics;
};

export interface DeadCodeResultCacheStoreInput {
  readonly cacheDirectory: string;
  readonly cacheKey: string;
  readonly rootDirectory: string;
  /** The pre-analysis stat snapshot (`collectAnalyzedFileStats`). */
  readonly snapshotFileStats: ReadonlyMap<string, AnalyzedFileStat>;
  readonly diagnostics: ReadonlyArray<Diagnostic>;
}

export const storeDeadCodeResultCache = (input: DeadCodeResultCacheStoreInput): void => {
  const persistedFiles: Record<string, PersistedFileIdentity> = {};
  for (const [relativePath, snapshotStat] of input.snapshotFileStats) {
    const absolutePath = path.join(input.rootDirectory, relativePath);
    // Hash first, stat second: a file edited during the analysis either fails
    // the stat re-verification below (edit before the hash) or changed after
    // the hash captured it — in which case the recorded hash matches the
    // pre-edit content and the next lookup misses on it. Either way a racing
    // edit can't produce a repairable stale entry. (Files added during the
    // analysis need no handling: they miss the lookup's path-set equality.)
    const contentHash = hashFileContents(absolutePath);
    if (contentHash === null) return;
    let currentStat: fs.Stats;
    try {
      currentStat = fs.statSync(absolutePath);
    } catch {
      return;
    }
    if (currentStat.mtimeMs !== snapshotStat.mtimeMs || currentStat.size !== snapshotStat.size) {
      return;
    }
    persistedFiles[relativePath] = [snapshotStat.mtimeMs, snapshotStat.size, contentHash];
  }
  atomicWriteJson(path.join(input.cacheDirectory, DEAD_CODE_CACHE_FILENAME), {
    version: DEAD_CODE_CACHE_SCHEMA_VERSION,
    key: input.cacheKey,
    files: persistedFiles,
    diagnostics: input.diagnostics,
  });
};
