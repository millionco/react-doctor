import * as path from "node:path";
import * as Schema from "effect/Schema";
import type { Diagnostic } from "../../types/index.js";
import {
  FILE_LINT_CACHE_FILENAME,
  FILE_LINT_CACHE_MAX_FILE_COUNT,
  FILE_LINT_CACHE_MAX_RULESET_COUNT,
  FILE_LINT_CACHE_SCHEMA_VERSION,
} from "../../constants.js";
import { Diagnostic as DiagnosticSchema } from "../../schemas.js";
import { atomicWriteJson } from "../../utils/atomic-write-json.js";
import { failOpenReadJson } from "../../utils/fail-open-read-json.js";
import { isRecord } from "../../utils/is-record.js";

/**
 * Per-file lint cache for the oxlint backend. Maps a per-file content key
 * (`<relativePath> <contentHash>`) to the RAW oxlint diagnostics that the
 * CACHEABLE rules produced for that file — the diagnostics before the
 * presentation pipeline (suppressions, surface filtering, fix grouping), so
 * those toggles never invalidate it. Cross-file rules are NEVER cached here;
 * they run in an always-fresh sidecar (see `run-oxlint.ts`).
 *
 * One file holds several ruleset buckets (LRU-pruned) so a toolchain/config
 * change mints a fresh bucket without discarding the others. Every operation
 * fails open: a missing or corrupt file degrades to a full re-lint, never to a
 * wrong result.
 */
export interface FileLintCache {
  /** Cached cacheable diagnostics for the key, or `null` on a miss. */
  readonly lookup: (fileKey: string) => ReadonlyArray<Diagnostic> | null;
  /** Records the freshly-linted cacheable diagnostics for a file. */
  readonly store: (fileKey: string, diagnostics: ReadonlyArray<Diagnostic>) => void;
  /** Flushes this run's entries to disk (call once, after the lint pass). */
  readonly persist: () => void;
}

interface PersistedRuleset {
  readonly updatedAtMs: number;
  readonly files: Record<string, ReadonlyArray<unknown>>;
}

interface PersistedFileLintCache {
  readonly version: number;
  readonly rulesets: Record<string, PersistedRuleset>;
}

const validateDiagnostic = Schema.decodeUnknownSync(DiagnosticSchema);

// Validate one file's stored diagnostics against the `Diagnostic` schema,
// returning `null` if ANY entry is malformed so the whole file degrades to a
// miss rather than a partial set. The records were serialized straight from
// the pipeline's `Diagnostic` shape, so the validated array is returned as-is
// (the schema's read-only arrays are a strict superset of the interface's).
const decodeFileDiagnostics = (raw: unknown): ReadonlyArray<Diagnostic> | null => {
  if (!Array.isArray(raw)) return null;
  try {
    for (const entry of raw) validateDiagnostic(entry);
    return raw as ReadonlyArray<Diagnostic>;
  } catch {
    return null;
  }
};

const emptyCache = (): PersistedFileLintCache => ({
  version: FILE_LINT_CACHE_SCHEMA_VERSION,
  rulesets: {},
});

const loadRulesetEntries = (
  cacheFilePath: string,
  rulesetHash: string,
): Map<string, ReadonlyArray<Diagnostic>> => {
  const entries = new Map<string, ReadonlyArray<Diagnostic>>();
  const persisted = failOpenReadJson<PersistedFileLintCache>(cacheFilePath, emptyCache());
  if (persisted.version !== FILE_LINT_CACHE_SCHEMA_VERSION || !isRecord(persisted.rulesets)) {
    return entries;
  }
  const bucket = persisted.rulesets[rulesetHash];
  if (!isRecord(bucket) || !isRecord(bucket.files)) return entries;
  for (const [fileKey, rawDiagnostics] of Object.entries(bucket.files)) {
    const decoded = decodeFileDiagnostics(rawDiagnostics);
    if (decoded !== null) entries.set(fileKey, decoded);
  }
  return entries;
};

export const createFileLintCache = (cacheDirectory: string, rulesetHash: string): FileLintCache => {
  const cacheFilePath = path.join(cacheDirectory, FILE_LINT_CACHE_FILENAME);
  const entries = loadRulesetEntries(cacheFilePath, rulesetHash);

  return {
    lookup: (fileKey) => entries.get(fileKey) ?? null,
    store: (fileKey, diagnostics) => {
      // Re-insert so the most recently stored keys sort last — the LRU window
      // kept on persist is the tail of insertion order.
      entries.delete(fileKey);
      entries.set(fileKey, diagnostics);
    },
    persist: () => {
      // Re-read so a sibling run writing a DIFFERENT ruleset bucket isn't
      // clobbered.
      const onDisk = failOpenReadJson<PersistedFileLintCache>(cacheFilePath, emptyCache());
      const rulesets: Record<string, PersistedRuleset> =
        onDisk.version === FILE_LINT_CACHE_SCHEMA_VERSION && isRecord(onDisk.rulesets)
          ? { ...onDisk.rulesets }
          : {};

      // Merge — not replace — our ruleset bucket: a sibling run sharing this
      // ruleset hash may have stored entries (for files we never touched) since
      // we loaded. Preserving them avoids erasing another run's work (extra
      // misses); our freshly-linted entries win for any shared key.
      const existingBucket = rulesets[rulesetHash];
      const existingFiles =
        isRecord(existingBucket) && isRecord(existingBucket.files) ? existingBucket.files : {};
      const ourFiles: Record<string, ReadonlyArray<unknown>> = {};
      for (const [fileKey, diagnostics] of entries) {
        // Fresh diagnostics are plain JSON-serializable records straight from
        // `parseOxlintOutput`; decoded hits are valid `Diagnostic`s. Both
        // serialize directly — `JSON.stringify` drops the `undefined` optionals.
        ourFiles[fileKey] = diagnostics;
      }
      const mergedEntries = Object.entries({ ...existingFiles, ...ourFiles });
      // Bound disk/memory; ours are appended last, so the slice keeps the most
      // recently linted entries when over the cap.
      const cappedEntries = mergedEntries.slice(-FILE_LINT_CACHE_MAX_FILE_COUNT);
      rulesets[rulesetHash] = {
        updatedAtMs: Date.now(),
        files: Object.fromEntries(cappedEntries),
      };

      const keptHashes = Object.entries(rulesets)
        .sort(([, first], [, second]) => second.updatedAtMs - first.updatedAtMs)
        .slice(0, FILE_LINT_CACHE_MAX_RULESET_COUNT)
        .map(([hash]) => hash);
      const prunedRulesets: Record<string, PersistedRuleset> = {};
      for (const hash of keptHashes) prunedRulesets[hash] = rulesets[hash];

      atomicWriteJson(cacheFilePath, {
        version: FILE_LINT_CACHE_SCHEMA_VERSION,
        rulesets: prunedRulesets,
      });
    },
  };
};
